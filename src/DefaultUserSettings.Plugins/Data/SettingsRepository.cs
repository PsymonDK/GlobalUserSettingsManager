using System;
using System.Collections.Generic;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace DefaultUserSettings.Plugins.Data
{
    /// <summary>Dataverse reads. One instance per plugin execution; no caching beyond that.</summary>
    public sealed class SettingsRepository
    {
        private const int MaxBusinessUnitDepth = 50;
        private readonly IOrganizationService _svc;

        public SettingsRepository(IOrganizationService svc)
        {
            _svc = svc;
        }

        /// <summary>Active Global and Group profiles (with scopes) plus the user's own User profile.</summary>
        public IList<SettingsProfile> LoadProfilesForUser(Guid userId)
        {
            var q = FullProfileQuery();
            q.Criteria.AddCondition(Names.Profile.IsActive, ConditionOperator.Equal, true);
            var typeFilter = new FilterExpression(LogicalOperator.Or);
            typeFilter.AddCondition(Names.Profile.Type, ConditionOperator.In, (int)ProfileType.Global, (int)ProfileType.Group);
            var userFilter = typeFilter.AddFilter(LogicalOperator.And);
            userFilter.AddCondition(Names.Profile.Type, ConditionOperator.Equal, (int)ProfileType.User);
            userFilter.AddCondition(Names.Profile.User, ConditionOperator.Equal, userId);
            q.Criteria.AddFilter(typeFilter);

            var profiles = RetrieveAll(q).Select(SettingsProfile.FromEntity).ToList();
            AttachScopes(profiles.Where(p => p.Type == ProfileType.Group).ToList());
            return profiles;
        }

        /// <summary>Profiles of one type, minimal columns, for uniqueness validation.</summary>
        public IList<SettingsProfile> LoadProfilesOfType(ProfileType type)
        {
            var q = new QueryExpression(Names.Profile.Entity)
            {
                ColumnSet = new ColumnSet(Names.Profile.Type, Names.Profile.Priority, Names.Profile.User, Names.Profile.Name),
                NoLock = true
            };
            q.Criteria.AddCondition(Names.Profile.Type, ConditionOperator.Equal, (int)type);
            return RetrieveAll(q).Select(SettingsProfile.FromEntity).ToList();
        }

        /// <summary>One profile with all setting columns, or null.</summary>
        public SettingsProfile LoadProfile(Guid profileId)
        {
            var q = FullProfileQuery();
            q.Criteria.AddCondition(Names.Profile.Id, ConditionOperator.Equal, profileId);
            var e = _svc.RetrieveMultiple(q).Entities.FirstOrDefault();
            return e == null ? null : SettingsProfile.FromEntity(e);
        }

        /// <summary>The user's User profile, active or not, or null.</summary>
        public SettingsProfile FindUserProfile(Guid userId)
        {
            var q = FullProfileQuery();
            q.Criteria.AddCondition(Names.Profile.Type, ConditionOperator.Equal, (int)ProfileType.User);
            q.Criteria.AddCondition(Names.Profile.User, ConditionOperator.Equal, userId);
            var e = _svc.RetrieveMultiple(q).Entities.FirstOrDefault();
            return e == null ? null : SettingsProfile.FromEntity(e);
        }

        /// <summary>The user's usersettings row (managed attributes), or null if it does not exist yet.</summary>
        public Entity LoadUserSettings(Guid userId)
        {
            var q = new QueryExpression(Names.UserSettings.Entity)
            {
                ColumnSet = new ColumnSet(SettingsRegistry.All.Select(s => s.Attribute).ToArray()),
                NoLock = true
            };
            q.Criteria.AddCondition(Names.UserSettings.Id, ConditionOperator.Equal, userId);
            return _svc.RetrieveMultiple(q).Entities.FirstOrDefault();
        }

        /// <summary>Create an active User profile ("User: full name") with the given setting columns. Returns its id.</summary>
        public Guid CreateUserProfile(Guid userId, Entity columns)
        {
            var user = _svc.Retrieve("systemuser", userId, new ColumnSet("fullname"));
            var row = new Entity(Names.Profile.Entity);
            foreach (var a in columns.Attributes) row[a.Key] = a.Value;
            row[Names.Profile.Name] = $"User: {user.GetAttributeValue<string>("fullname")}";
            row[Names.Profile.Type] = new OptionSetValue((int)ProfileType.User);
            row[Names.Profile.User] = new EntityReference("systemuser", userId);
            row[Names.Profile.IsActive] = true;
            return _svc.Create(row);
        }

        private static QueryExpression FullProfileQuery() => new QueryExpression(Names.Profile.Entity)
        {
            ColumnSet = new ColumnSet(new[] { Names.Profile.Name, Names.Profile.Type, Names.Profile.Priority, Names.Profile.IsActive,
                Names.Profile.User, Names.Profile.PilotTeam, Names.Profile.CreatedOn }.Concat(SettingsRegistry.ProfileColumns()).ToArray()),
            NoLock = true
        };

        public ProfileType? GetProfileType(Guid profileId)
        {
            var e = _svc.Retrieve(Names.Profile.Entity, profileId, new ColumnSet(Names.Profile.Type));
            return (ProfileType?)e.GetAttributeValue<OptionSetValue>(Names.Profile.Type)?.Value;
        }

        public UserMembership LoadMembership(Guid userId)
        {
            var user = _svc.Retrieve("systemuser", userId, new ColumnSet("businessunitid"));
            var bu = user.GetAttributeValue<EntityReference>("businessunitid").Id;

            var ancestors = new List<Guid>();
            var current = bu;
            for (var i = 0; i < MaxBusinessUnitDepth; i++)
            {
                var parent = _svc.Retrieve("businessunit", current, new ColumnSet("parentbusinessunitid"))
                    .GetAttributeValue<EntityReference>("parentbusinessunitid");
                if (parent == null) break;
                ancestors.Add(parent.Id);
                current = parent.Id;
            }

            var tm = new QueryExpression("teammembership") { ColumnSet = new ColumnSet("teamid"), NoLock = true };
            tm.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, userId);
            var teams = RetrieveAll(tm).Select(e => e.GetAttributeValue<Guid>("teamid"));

            return new UserMembership(userId, bu, ancestors, teams);
        }

        private void AttachScopes(IList<SettingsProfile> groups)
        {
            if (groups.Count == 0) return;
            var q = new QueryExpression(Names.Scope.Entity)
            {
                ColumnSet = new ColumnSet(Names.Scope.Profile, Names.Scope.ScopeType, Names.Scope.Team, Names.Scope.BusinessUnit, Names.Scope.IncludeChildBusinessUnits),
                NoLock = true
            };
            q.Criteria.AddCondition(Names.Scope.Profile, ConditionOperator.In, groups.Select(g => (object)g.Id).ToArray());
            q.Criteria.AddCondition("statecode", ConditionOperator.Equal, 0);
            var byProfile = groups.ToDictionary(g => g.Id);
            foreach (var scope in RetrieveAll(q).Select(ProfileScope.FromEntity))
                if (byProfile.TryGetValue(scope.ProfileId, out var p)) p.Scopes.Add(scope);
        }

        private IEnumerable<Entity> RetrieveAll(QueryExpression q)
        {
            q.PageInfo = new PagingInfo { Count = 5000, PageNumber = 1 };
            while (true)
            {
                var page = _svc.RetrieveMultiple(q);
                foreach (var e in page.Entities) yield return e;
                if (!page.MoreRecords) yield break;
                q.PageInfo.PageNumber++;
                q.PageInfo.PagingCookie = page.PagingCookie;
            }
        }
    }
}
