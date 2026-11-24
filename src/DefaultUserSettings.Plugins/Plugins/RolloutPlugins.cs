using System;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Rollout;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace DefaultUserSettings.Plugins.Plugins
{
    /// <summary>
    /// jhrb_rolloutjob Create and Update (filtering attribute jhrb_continue), PostOperation, asynchronous. Plan 5.4.
    /// Runs one chunk (90 s budget), then continues itself by bumping jhrb_continue. Near the platform depth limit it
    /// stops and leaves the job Pending; the daily heartbeat resumes it from a fresh context.
    /// </summary>
    public sealed class RolloutJobPlugin : PluginBase
    {
        private const int MaxErrorText = 100000;
        private const int ContinueBelowDepth = 7;

        protected override void Execute(LocalContext local)
        {
            var id = local.Context.PrimaryEntityId;
            var job = local.SystemService.Retrieve(Names.Job.Entity, id, new ColumnSet(true));
            var status = (JobStatus?)job.GetAttributeValue<OptionSetValue>(Names.Job.Status)?.Value;
            if (status != JobStatus.Pending && status != JobStatus.Running) return;

            local.Context.SharedVariables[Names.SharedVariableRollout] = true;
            var start = new Entity(Names.Job.Entity, id) { [Names.Job.Status] = new OptionSetValue((int)JobStatus.Running) };
            if (!job.Contains(Names.Job.StartedOn)) start[Names.Job.StartedOn] = DateTime.UtcNow;
            local.SystemService.Update(start);

            ChunkResult result;
            try
            {
                var spec = JobSpec.FromEntity(job);
                result = new RolloutProcessor(local.SystemService, local.Trace).Run(spec, TimeSpan.FromSeconds(spec.ChunkSeconds));
            }
            catch (Exception ex)
            {
                local.SystemService.Update(new Entity(Names.Job.Entity, id)
                {
                    [Names.Job.Status] = new OptionSetValue((int)JobStatus.Failed),
                    [Names.Job.CompletedOn] = DateTime.UtcNow,
                    [Names.Job.Error] = Tail(job.GetAttributeValue<string>(Names.Job.Error) + ex)
                });
                return;
            }

            var update = new Entity(Names.Job.Entity, id)
            {
                [Names.Job.Processed] = (job.GetAttributeValue<int?>(Names.Job.Processed) ?? 0) + result.Processed,
                [Names.Job.Updated] = (job.GetAttributeValue<int?>(Names.Job.Updated) ?? 0) + result.Updated,
                [Names.Job.Unchanged] = (job.GetAttributeValue<int?>(Names.Job.Unchanged) ?? 0) + result.Unchanged,
                [Names.Job.Failed] = (job.GetAttributeValue<int?>(Names.Job.Failed) ?? 0) + result.Failed,
                [Names.Job.Chunks] = (job.GetAttributeValue<int?>(Names.Job.Chunks) ?? 0) + 1,
                [Names.Job.Cursor] = result.Cursor?.ToString()
            };
            if (result.Errors.Length > 0) update[Names.Job.Error] = Tail(job.GetAttributeValue<string>(Names.Job.Error) + result.Errors);

            if (result.Finished)
            {
                update[Names.Job.Status] = new OptionSetValue((int)JobStatus.Completed);
                update[Names.Job.CompletedOn] = DateTime.UtcNow;
            }
            else if (local.Context.Depth < ContinueBelowDepth)
            {
                update[Names.Job.Continue] = (job.GetAttributeValue<int?>(Names.Job.Continue) ?? 0) + 1;
            }
            else
            {
                update[Names.Job.Status] = new OptionSetValue((int)JobStatus.Pending);
                local.Trace.Trace("Depth {0}: leaving job Pending for the heartbeat to resume.", local.Context.Depth);
            }
            local.SystemService.Update(update);
        }

        private static string Tail(string s) => s == null || s.Length <= MaxErrorText ? s : s.Substring(s.Length - MaxErrorText);
    }

    /// <summary>
    /// jhrb_settingsprofile Create/Update/Delete, PostOperation, asynchronous. Images: PreImage (Update, Delete), PostImage (Create, Update).
    /// Value/mode changes -> Full rollout of the changed settings. Structural changes -> Auto rollout of everything.
    /// User profiles -> a job for that user only.
    /// </summary>
    public sealed class ProfileChangePlugin : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var ctx = local.Context;
            var pre = local.PreImage();
            var post = ctx.PostEntityImages.Contains("PostImage") ? ctx.PostEntityImages["PostImage"] : null;
            var before = pre == null || ctx.MessageName == "Create" ? null : SettingsProfile.FromEntity(pre);
            var after = post == null || ctx.MessageName == "Delete" ? null : SettingsProfile.FromEntity(post);
            var row = after ?? before;
            if (row == null) return;

            var change = ChangeDetector.Detect(before, after);
            if (!change.Any) return;

            var isUser = row.Type == ProfileType.User && row.UserId.HasValue;
            var scope = isUser ? JobScope.User : JobScope.All;
            var reason = isUser ? JobReason.UserOverride : JobReason.ProfileChange;
            var profileId = ctx.MessageName == "Delete" ? (Guid?)null : row.Id;
            var who = isUser ? $"user override '{row.Name}'" : $"profile '{row.Name}'";

            if (change.Structural)
                JobService.Create(local.SystemService, $"{ctx.MessageName} of {who}", scope, ApplyMode.Auto, reason, row.UserId, profileId);
            else
                JobService.Create(local.SystemService, $"Change of {string.Join(", ", change.ChangedSettings.Take(5))}{(change.ChangedSettings.Count > 5 ? ", ..." : "")} in {who}",
                    scope, ApplyMode.Full, reason, isUser ? row.UserId : null, profileId, change.ChangedSettings);
        }
    }

    /// <summary>jhrb_profilescope Create/Update/Delete, PostOperation, asynchronous. Membership rules changed -> Auto rollout.</summary>
    public sealed class ScopeChangePlugin : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var image = local.Context.PostEntityImages.Contains("PostImage") ? local.Context.PostEntityImages["PostImage"] : local.PreImage();
            var profile = image?.GetAttributeValue<EntityReference>(Names.Scope.Profile);
            JobService.Create(local.SystemService, $"{local.Context.MessageName} of scope '{image?.GetAttributeValue<string>(Names.Scope.Name)}'",
                JobScope.All, ApplyMode.Auto, JobReason.ProfileChange, null, local.Context.MessageName == "Delete" ? null : profile?.Id);
        }
    }

    /// <summary>
    /// Associate/Disassociate (teammembership_association) and systemuser Update (businessunitid), PostOperation, synchronous.
    /// Creates an Auto job per affected user. Never throws: a failure here must not block membership changes.
    /// Note (SPIKE D/E): AddMembersTeam/RemoveMembersTeam and SetBusiness fire no events; the daily reconcile covers them.
    /// </summary>
    public sealed class MembershipChangePlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var local = new LocalContext(serviceProvider);
            try
            {
                var ctx = local.Context;
                if (ctx.MessageName == "Associate" || ctx.MessageName == "Disassociate")
                {
                    if (!(ctx.InputParameters["Relationship"] is Relationship rel) || rel.SchemaName != "teammembership_association") return;
                    var target = (EntityReference)ctx.InputParameters["Target"];
                    var related = (EntityReferenceCollection)ctx.InputParameters["RelatedEntities"];
                    var users = related.Where(r => r.LogicalName == "systemuser").Select(r => r.Id).ToList();
                    if (target.LogicalName == "systemuser") users.Add(target.Id);
                    foreach (var u in users.Distinct())
                        JobService.Create(local.SystemService, $"Team membership {ctx.MessageName.ToLowerInvariant()}", JobScope.User, ApplyMode.Auto, JobReason.Membership, u);
                }
                else if (ctx.MessageName == "Update" && ctx.PrimaryEntityName == "systemuser" && local.Target?.Contains("businessunitid") == true)
                {
                    JobService.Create(local.SystemService, "Business unit change", JobScope.User, ApplyMode.Auto, JobReason.Membership, ctx.PrimaryEntityId);
                }
            }
            catch (Exception ex)
            {
                local.Trace.Trace("Membership change not queued (reconcile will catch up): {0}", ex);
            }
        }
    }

    /// <summary>
    /// systemuser Create, PostOperation, synchronous. Queues a User job (Auto = full apply for a new user).
    /// The job waits up to 60 s for the usersettings row (SPIKE B). Never throws.
    /// </summary>
    public sealed class NewUserPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var local = new LocalContext(serviceProvider);
            try
            {
                JobService.Create(local.SystemService, "New user", JobScope.User, ApplyMode.Auto, JobReason.NewUser, local.Context.PrimaryEntityId);
            }
            catch (Exception ex)
            {
                local.Trace.Trace("New user job not queued (reconcile will catch up): {0}", ex);
            }
        }
    }

    /// <summary>
    /// jhrb_heartbeat Delete, PostOperation, asynchronous. A recurring bulk delete job deletes the heartbeat row daily
    /// (no Power Automate). Starts the reconcile, resumes stalled jobs and creates the next heartbeat row.
    /// </summary>
    public sealed class HeartbeatPlugin : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            Reconcile.Run(local.SystemService);
            local.SystemService.Create(new Entity(Names.Heartbeat.Entity) { [Names.Heartbeat.Name] = $"Heartbeat {DateTime.UtcNow:yyyy-MM-dd HH:mm}Z" });
            try { PurgeOldLogs(local.SystemService); }
            catch (Exception ex) { local.Trace.Trace("Log retention bulk delete not started: {0}", ex.Message); }
        }

        /// <summary>Log retention (decision 27): a one-off system bulk delete of log rows older than 90 days, started daily.</summary>
        private static void PurgeOldLogs(IOrganizationService svc)
        {
            var q = new QueryExpression(Names.Log.Entity) { ColumnSet = new ColumnSet(false) };
            q.Criteria.AddCondition("createdon", ConditionOperator.OlderThanXDays, 90);
            svc.Execute(new Microsoft.Crm.Sdk.Messages.BulkDeleteRequest
            {
                JobName = $"Default User Settings: log retention {DateTime.UtcNow:yyyy-MM-dd}",
                QuerySet = new[] { q },
                StartDateTime = DateTime.UtcNow,
                RecurrencePattern = string.Empty,
                SendEmailNotification = false,
                ToRecipients = new Guid[0],
                CCRecipients = new Guid[0]
            });
        }
    }

    public static class Reconcile
    {
        public static Guid Run(IOrganizationService svc)
        {
            JobService.ResumeStalled(svc, TimeSpan.FromMinutes(15));
            return JobService.Create(svc, $"Daily reconcile {DateTime.UtcNow:yyyy-MM-dd}", JobScope.All, ApplyMode.Auto, JobReason.Reconcile);
        }
    }
}
