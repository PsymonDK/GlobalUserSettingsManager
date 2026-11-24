using System;
using DefaultUserSettings.Plugins;
using DefaultUserSettings.Plugins.Model;

namespace DefaultUserSettings.Plugins.Tests
{
    internal static class Build
    {
        public static readonly Guid UserId = Guid.NewGuid();
        public static readonly Guid RootBu = Guid.NewGuid();
        public static readonly Guid ChildBu = Guid.NewGuid();
        public static readonly Guid GrandChildBu = Guid.NewGuid();
        public static readonly Guid TeamA = Guid.NewGuid();
        public static readonly Guid TeamB = Guid.NewGuid();

        public static SettingsProfile Global(string name = "Global") =>
            new SettingsProfile { Id = Guid.NewGuid(), Name = name, Type = ProfileType.Global, CreatedOn = new DateTime(2026, 1, 1) };

        public static SettingsProfile Group(string name, int priority, params ProfileScope[] scopes)
        {
            var p = new SettingsProfile { Id = Guid.NewGuid(), Name = name, Type = ProfileType.Group, Priority = priority, CreatedOn = new DateTime(2026, 1, 2) };
            foreach (var s in scopes) { s.ProfileId = p.Id; p.Scopes.Add(s); }
            return p;
        }

        public static SettingsProfile User(Guid userId) =>
            new SettingsProfile { Id = Guid.NewGuid(), Name = "User", Type = ProfileType.User, UserId = userId, CreatedOn = new DateTime(2026, 1, 3) };

        public static SettingsProfile With(this SettingsProfile p, string attribute, SettingMode mode, object value)
        {
            p.Settings[attribute] = new ProfileSetting(mode, value);
            return p;
        }

        public static ProfileScope TeamScope(Guid team) => new ProfileScope { Id = Guid.NewGuid(), ScopeType = ScopeType.Team, TeamId = team };

        public static ProfileScope BuScope(Guid bu, bool includeChildren = false) =>
            new ProfileScope { Id = Guid.NewGuid(), ScopeType = ScopeType.BusinessUnit, BusinessUnitId = bu, IncludeChildBusinessUnits = includeChildren };

        /// <summary>User in GrandChildBu (ancestors ChildBu, RootBu) and the given teams.</summary>
        public static UserMembership Member(params Guid[] teams) =>
            new UserMembership(UserId, GrandChildBu, new[] { ChildBu, RootBu }, teams);
    }
}
