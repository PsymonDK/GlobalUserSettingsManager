using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace DefaultUserSettings.Plugins.Rollout
{
    /// <summary>Creates and resumes rollout jobs. Creating a job row starts the async RolloutJobPlugin.</summary>
    public static class JobService
    {
        public static Guid Create(IOrganizationService svc, string name, JobScope scope, ApplyMode mode, JobReason reason,
            Guid? userId = null, Guid? profileId = null, IEnumerable<string> settings = null, bool dryRun = false, bool ignorePilot = false, int? batchSize = null, int? chunkSeconds = null)
        {
            var filter = settings == null ? null : string.Join(",", settings);
            var e = new Entity(Names.Job.Entity)
            {
                [Names.Job.Name] = name.Length > 200 ? name.Substring(0, 200) : name,
                [Names.Job.Status] = new OptionSetValue((int)JobStatus.Pending),
                [Names.Job.Scope] = new OptionSetValue((int)scope),
                [Names.Job.ApplyMode] = new OptionSetValue((int)mode),
                [Names.Job.Reason] = new OptionSetValue((int)reason),
                [Names.Job.DryRun] = dryRun,
                [Names.Job.IgnorePilot] = ignorePilot && dryRun,
                [Names.Job.BatchSize] = batchSize ?? 200
            };
            if (!string.IsNullOrEmpty(filter)) e[Names.Job.SettingFilter] = filter.Length > 4000 ? filter.Substring(0, 4000) : filter;
            if (chunkSeconds.HasValue) e[Names.Job.ChunkSeconds] = chunkSeconds.Value;
            if (userId.HasValue) e[Names.Job.User] = new EntityReference("systemuser", userId.Value);
            if (profileId.HasValue) e[Names.Job.Profile] = new EntityReference(Names.Profile.Entity, profileId.Value);
            return svc.Create(e);
        }

        /// <summary>Kicks jobs that stopped (depth limit, platform restart) by bumping jhrb_continue from a fresh context.</summary>
        public static int ResumeStalled(IOrganizationService svc, TimeSpan idle)
        {
            var q = new QueryExpression(Names.Job.Entity) { ColumnSet = new ColumnSet(Names.Job.Continue), NoLock = true };
            q.Criteria.AddCondition(Names.Job.Status, ConditionOperator.In, (int)JobStatus.Pending, (int)JobStatus.Running);
            q.Criteria.AddCondition("modifiedon", ConditionOperator.LessThan, DateTime.UtcNow - idle);
            var jobs = svc.RetrieveMultiple(q).Entities.ToList();
            foreach (var j in jobs)
                svc.Update(new Entity(Names.Job.Entity, j.Id) { [Names.Job.Continue] = (j.GetAttributeValue<int?>(Names.Job.Continue) ?? 0) + 1 });
            return jobs.Count;
        }
    }
}
