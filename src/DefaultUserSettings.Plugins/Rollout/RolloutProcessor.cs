using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Threading;
using DefaultUserSettings.Plugins.Data;
using DefaultUserSettings.Plugins.Model;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;

namespace DefaultUserSettings.Plugins.Rollout
{
    public sealed class JobSpec
    {
        public JobScope Scope { get; set; } = JobScope.All;
        public ApplyMode Mode { get; set; } = ApplyMode.Full;
        public Guid? UserId { get; set; }
        public ISet<string> SettingFilter { get; set; }
        public bool DryRun { get; set; }
        public bool IgnorePilot { get; set; }
        public int BatchSize { get; set; } = 200;
        public int ChunkSeconds { get; set; } = 90;
        public Guid? Cursor { get; set; }
        public LogSource LogSource { get; set; } = LogSource.Rollout;

        public static JobSpec FromEntity(Entity job) => new JobSpec
        {
            Scope = (JobScope?)job.GetAttributeValue<OptionSetValue>(Names.Job.Scope)?.Value ?? JobScope.All,
            Mode = (ApplyMode?)job.GetAttributeValue<OptionSetValue>(Names.Job.ApplyMode)?.Value ?? ApplyMode.Full,
            UserId = job.GetAttributeValue<EntityReference>(Names.Job.User)?.Id,
            SettingFilter = RolloutPlanner.ParseFilter(job.GetAttributeValue<string>(Names.Job.SettingFilter)),
            DryRun = job.GetAttributeValue<bool>(Names.Job.DryRun),
            IgnorePilot = job.GetAttributeValue<bool>(Names.Job.IgnorePilot),
            BatchSize = Math.Max(1, Math.Min(5000, job.GetAttributeValue<int?>(Names.Job.BatchSize) ?? 200)),
            ChunkSeconds = Math.Max(1, Math.Min(110, job.GetAttributeValue<int?>(Names.Job.ChunkSeconds) ?? 90)),
            Cursor = Guid.TryParse(job.GetAttributeValue<string>(Names.Job.Cursor), out var c) ? c : (Guid?)null,
            LogSource = ToLogSource((JobReason?)job.GetAttributeValue<OptionSetValue>(Names.Job.Reason)?.Value)
        };

        private static LogSource ToLogSource(JobReason? reason)
        {
            switch (reason)
            {
                case JobReason.NewUser: return LogSource.NewUser;
                case JobReason.Membership: return LogSource.GroupChange;
                case JobReason.Manual:
                case JobReason.UserOverride: return LogSource.Manual;
                default: return LogSource.Rollout;
            }
        }
    }

    public sealed class ChunkResult
    {
        public int Processed { get; set; }
        public int Updated { get; set; }
        public int Unchanged { get; set; }
        public int Failed { get; set; }
        public Guid? Cursor { get; set; }
        public bool Finished { get; set; }
        public StringBuilder Errors { get; } = new StringBuilder();
    }

    /// <summary>
    /// Processes users in pages until the time budget runs out (plugins have 2 minutes).
    /// Writes only differing attributes, tagged so the lock plugin recognises rollout writes.
    /// </summary>
    public sealed class RolloutProcessor
    {
        public static readonly TimeSpan DefaultBudget = TimeSpan.FromSeconds(90);
        private static readonly TimeSpan NewUserWait = TimeSpan.FromSeconds(60);

        private readonly IOrganizationService _svc;
        private readonly ITracingService _trace;

        public RolloutProcessor(IOrganizationService svc, ITracingService trace)
        {
            _svc = svc;
            _trace = trace;
        }

        public ChunkResult Run(JobSpec spec, TimeSpan budget)
        {
            var clock = Stopwatch.StartNew();
            var result = new ChunkResult { Cursor = spec.Cursor };
            var repo = new RolloutRepository(_svc);
            var profiles = repo.LoadAllActiveProfiles();
            var global = profiles.FirstOrDefault(p => p.Type == ProfileType.Global);
            if (global == null)
            {
                result.Finished = true;
                result.Errors.AppendLine("No active Global profile: nothing to roll out.");
                return result;
            }
            var pilot = spec.DryRun && spec.IgnorePilot ? null : global.PilotTeamId;
            var log = new SettingsLogWriter(_svc);

            while (clock.Elapsed < budget)
            {
                var single = spec.Scope == JobScope.User ? spec.UserId : null;
                if (spec.Scope == JobScope.User && !single.HasValue) { result.Errors.AppendLine("User scope without user."); result.Finished = true; break; }

                var users = repo.NextUsers(single.HasValue ? null : result.Cursor, single.HasValue ? 1 : spec.BatchSize, pilot, single);
                if (users.Count == 0) { result.Finished = true; break; }

                var memberships = repo.LoadMemberships(users);
                var settings = repo.LoadUserSettings(users.Select(u => u.Id));
                if (single.HasValue && !settings.ContainsKey(single.Value))
                    settings = WaitForUserSettings(repo, single.Value, settings); // SPIKE B: row can appear seconds after the user
                var states = repo.LoadUserStates(users.Select(u => u.Id));

                foreach (var user in users)
                {
                    result.Processed++;
                    result.Cursor = user.Id;
                    try
                    {
                        if (!settings.TryGetValue(user.Id, out var current))
                        {
                            result.Unchanged++;
                            result.Errors.AppendLine($"{user.Id}: no usersettings row yet; reconcile will pick it up.");
                            continue;
                        }
                        states.TryGetValue(user.Id, out var state);
                        var plan = RolloutPlanner.Plan(user.Id, profiles, memberships[user.Id], current, spec.Mode,
                            spec.SettingFilter, state?.GetAttributeValue<string>(Names.UserState.Fingerprint));

                        if (plan.Changes.Count == 0) result.Unchanged++; else result.Updated++;
                        if (spec.DryRun) continue;

                        if (plan.Changes.Count > 0)
                        {
                            var request = new UpdateRequest { Target = plan.ToUpdate() };
                            request.Parameters["tag"] = Names.RolloutTag;
                            _svc.Execute(request);
                            foreach (var c in plan.Changes)
                                log.Write(user.Id, c.Effective.Definition, spec.LogSource, c.OldValue, null, c.Effective.Value, c.Effective.Source.Id);
                        }
                        if (plan.WriteState && (spec.SettingFilter == null || spec.SettingFilter.Count == 0))
                            repo.WriteUserState(user.Id, state, plan.Fingerprint);
                    }
                    catch (Exception ex)
                    {
                        result.Failed++;
                        result.Errors.AppendLine($"{user.Id}: {ex.Message}");
                        _trace?.Trace("User {0} failed: {1}", user.Id, ex);
                    }
                }

                if (single.HasValue || users.Count < spec.BatchSize) { result.Finished = true; break; }
            }
            return result;
        }

        private IDictionary<Guid, Entity> WaitForUserSettings(RolloutRepository repo, Guid userId, IDictionary<Guid, Entity> current)
        {
            var clock = Stopwatch.StartNew();
            while (clock.Elapsed < NewUserWait)
            {
                Thread.Sleep(5000);
                var s = repo.LoadUserSettings(new[] { userId });
                if (s.Count > 0) return s;
            }
            return current;
        }
    }
}
