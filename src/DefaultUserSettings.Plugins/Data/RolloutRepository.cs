using System;
using System.Collections.Generic;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace DefaultUserSettings.Plugins.Data
{
    public sealed class UserRow
    {
        public Guid Id { get; set; }
        public Guid BusinessUnitId { get; set; }
    }

    /// <summary>Batch reads/writes for rollout. One instance per execution.</summary>
    public sealed class RolloutRepository
    {
        private readonly IOrganizationService _svc;
        private Dictionary<Guid, Guid?> _buParents;

        public RolloutRepository(IOrganizationService svc)
        {
            _svc = svc;
        }

        /// <summary>All active profiles of every type (all users' override rows included), with scopes.</summary>
        public IList<SettingsProfile> LoadAllActiveProfiles()
        {
            var q = new QueryExpression(Names.Profile.Entity)
            {
                ColumnSet = new ColumnSet(new[] { Names.Profile.Name, Names.Profile.Type, Names.Profile.Priority, Names.Profile.IsActive,
                    Names.Profile.User, Names.Profile.PilotTeam, Names.Profile.CreatedOn }.Concat(SettingsRegistry.ProfileColumns()).ToArray()),
                NoLock = true
            };
            q.Criteria.AddCondition(Names.Profile.IsActive, ConditionOperator.Equal, true);
            var profiles = Query.All(_svc, q).Select(SettingsProfile.FromEntity).ToList();

            var groups = profiles.Where(p => p.Type == ProfileType.Group).ToDictionary(p => p.Id);
            if (groups.Count > 0)
            {
                var sq = new QueryExpression(Names.Scope.Entity)
                {
                    ColumnSet = new ColumnSet(Names.Scope.Profile, Names.Scope.ScopeType, Names.Scope.Team, Names.Scope.BusinessUnit, Names.Scope.IncludeChildBusinessUnits),
                    NoLock = true
                };
                sq.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);
                foreach (var s in Query.All(_svc, sq).Select(ProfileScope.FromEntity))
                    if (groups.TryGetValue(s.ProfileId, out var g)) g.Scopes.Add(s);
            }
            return profiles;
        }

        /// <summary>
        /// Next page of in-scope users ordered by systemuserid after the cursor.
        /// In scope (owner decision 4): enabled, licensed, read-write access mode, not an application user.
        /// </summary>
        public IList<UserRow> NextUsers(Guid? cursor, int count, Guid? pilotTeamId, Guid? singleUser)
        {
            var q = new QueryExpression("systemuser") { ColumnSet = new ColumnSet("businessunitid"), NoLock = true, TopCount = count };
            q.AddOrder("systemuserid", OrderType.Ascending);
            q.Criteria.AddCondition("isdisabled", ConditionOperator.Equal, false);
            q.Criteria.AddCondition("accessmode", ConditionOperator.Equal, 0);
            q.Criteria.AddCondition("applicationid", ConditionOperator.Null);
            if (singleUser.HasValue)
                q.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, singleUser.Value); // new users may not be licensed yet
            else
                q.Criteria.AddCondition("islicensed", ConditionOperator.Equal, true);
            if (cursor.HasValue) q.Criteria.AddCondition("systemuserid", ConditionOperator.GreaterThan, cursor.Value);
            if (pilotTeamId.HasValue)
            {
                var tm = q.AddLink("teammembership", "systemuserid", "systemuserid");
                tm.LinkCriteria.AddCondition("teamid", ConditionOperator.Equal, pilotTeamId.Value);
            }
            return _svc.RetrieveMultiple(q).Entities
                .Select(e => new UserRow { Id = e.Id, BusinessUnitId = e.GetAttributeValue<EntityReference>("businessunitid").Id })
                .ToList();
        }

        public IDictionary<Guid, UserMembership> LoadMemberships(IList<UserRow> users)
        {
            var result = new Dictionary<Guid, UserMembership>();
            if (users.Count == 0) return result;
            var teams = users.ToDictionary(u => u.Id, u => new List<Guid>());
            var q = new QueryExpression("teammembership") { ColumnSet = new ColumnSet("teamid", "systemuserid"), NoLock = true };
            q.Criteria.AddCondition("systemuserid", ConditionOperator.In, users.Select(u => (object)u.Id).ToArray());
            foreach (var e in Query.All(_svc, q))
                teams[e.GetAttributeValue<Guid>("systemuserid")].Add(e.GetAttributeValue<Guid>("teamid"));
            foreach (var u in users)
                result[u.Id] = new UserMembership(u.Id, u.BusinessUnitId, Ancestors(u.BusinessUnitId), teams[u.Id]);
            return result;
        }

        public IDictionary<Guid, Entity> LoadUserSettings(IEnumerable<Guid> userIds)
        {
            var ids = userIds.Select(i => (object)i).ToArray();
            if (ids.Length == 0) return new Dictionary<Guid, Entity>();
            var q = new QueryExpression(Names.UserSettings.Entity)
            {
                ColumnSet = new ColumnSet(SettingsRegistry.All.Select(s => s.Attribute).ToArray()),
                NoLock = true
            };
            q.Criteria.AddCondition(Names.UserSettings.Id, ConditionOperator.In, ids);
            return Query.All(_svc, q).ToDictionary(e => e.Id);
        }

        public IDictionary<Guid, Entity> LoadUserStates(IEnumerable<Guid> userIds)
        {
            var ids = userIds.Select(i => (object)i).ToArray();
            var result = new Dictionary<Guid, Entity>();
            if (ids.Length == 0) return result;
            var q = new QueryExpression(Names.UserState.Entity) { ColumnSet = new ColumnSet(Names.UserState.User, Names.UserState.Fingerprint, Names.UserState.InitializedOn), NoLock = true };
            q.Criteria.AddCondition(Names.UserState.User, ConditionOperator.In, ids);
            foreach (var e in Query.All(_svc, q))
            {
                var u = e.GetAttributeValue<EntityReference>(Names.UserState.User)?.Id;
                if (u.HasValue && !result.ContainsKey(u.Value)) result[u.Value] = e;
            }
            return result;
        }

        public void WriteUserState(Guid userId, Entity existing, string fingerprint)
        {
            var now = DateTime.UtcNow;
            var e = new Entity(Names.UserState.Entity)
            {
                [Names.UserState.Fingerprint] = fingerprint.Length > 4000 ? fingerprint.Substring(0, 4000) : fingerprint,
                [Names.UserState.LastFullApplyOn] = now
            };
            if (existing == null)
            {
                e[Names.UserState.Name] = userId.ToString();
                e[Names.UserState.User] = new EntityReference("systemuser", userId);
                e[Names.UserState.InitializedOn] = now;
                _svc.Create(e);
            }
            else
            {
                e.Id = existing.Id;
                if (!existing.Contains(Names.UserState.InitializedOn)) e[Names.UserState.InitializedOn] = now;
                _svc.Update(e);
            }
        }

        private IEnumerable<Guid> Ancestors(Guid bu)
        {
            if (_buParents == null)
            {
                var q = new QueryExpression("businessunit") { ColumnSet = new ColumnSet("parentbusinessunitid"), NoLock = true };
                _buParents = Query.All(_svc, q).ToDictionary(e => e.Id, e => e.GetAttributeValue<EntityReference>("parentbusinessunitid")?.Id);
            }
            var result = new List<Guid>();
            var current = bu;
            for (var i = 0; i < 50 && _buParents.TryGetValue(current, out var parent) && parent.HasValue; i++)
            {
                result.Add(parent.Value);
                current = parent.Value;
            }
            return result;
        }
    }

    internal static class Query
    {
        public static IEnumerable<Entity> All(IOrganizationService svc, QueryExpression q)
        {
            q.PageInfo = new PagingInfo { Count = 5000, PageNumber = 1 };
            while (true)
            {
                var page = svc.RetrieveMultiple(q);
                foreach (var e in page.Entities) yield return e;
                if (!page.MoreRecords) yield break;
                q.PageInfo.PageNumber++;
                q.PageInfo.PagingCookie = page.PagingCookie;
            }
        }
    }
}
