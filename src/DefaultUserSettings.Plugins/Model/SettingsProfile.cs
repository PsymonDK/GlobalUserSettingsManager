using System;
using System.Collections.Generic;
using DefaultUserSettings.Plugins.Registry;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Model
{
    public sealed class ProfileSetting
    {
        public ProfileSetting(SettingMode mode, object profileValue)
        {
            Mode = mode;
            ProfileValue = profileValue;
        }

        public SettingMode Mode { get; }
        /// <summary>Raw value from the profile column (int, string, bool, OptionSetValue, EntityReference).</summary>
        public object ProfileValue { get; }
    }

    /// <summary>In-memory view of a jhrb_settingsprofile row.</summary>
    public sealed class SettingsProfile
    {
        public Guid Id { get; set; }
        public string Name { get; set; }
        public ProfileType? Type { get; set; }
        public int? Priority { get; set; }
        public bool IsActive { get; set; } = true;
        public Guid? UserId { get; set; }
        public Guid? PilotTeamId { get; set; }
        public DateTime CreatedOn { get; set; }
        public Dictionary<string, ProfileSetting> Settings { get; } = new Dictionary<string, ProfileSetting>(StringComparer.OrdinalIgnoreCase);
        public List<ProfileScope> Scopes { get; } = new List<ProfileScope>();

        public ProfileSetting Get(string attribute) =>
            Settings.TryGetValue(attribute, out var s) ? s : null;

        public static SettingsProfile FromEntity(Entity e)
        {
            var p = new SettingsProfile
            {
                Id = e.Id,
                Name = e.GetAttributeValue<string>(Names.Profile.Name),
                Type = (ProfileType?)e.GetAttributeValue<OptionSetValue>(Names.Profile.Type)?.Value,
                Priority = e.GetAttributeValue<int?>(Names.Profile.Priority),
                IsActive = e.Contains(Names.Profile.IsActive) ? e.GetAttributeValue<bool>(Names.Profile.IsActive) : true,
                UserId = e.GetAttributeValue<EntityReference>(Names.Profile.User)?.Id,
                PilotTeamId = e.GetAttributeValue<EntityReference>(Names.Profile.PilotTeam)?.Id,
                CreatedOn = e.GetAttributeValue<DateTime?>(Names.Profile.CreatedOn) ?? DateTime.MinValue
            };
            foreach (var d in SettingsRegistry.All)
            {
                var mode = (SettingMode?)e.GetAttributeValue<OptionSetValue>(d.ModeColumn)?.Value ?? SettingMode.Inherit;
                var value = e.Contains(d.ValueColumn) ? e[d.ValueColumn] : null;
                p.Settings[d.Attribute] = new ProfileSetting(mode, value);
            }
            return p;
        }
    }

    public sealed class ProfileScope
    {
        public Guid Id { get; set; }
        public Guid ProfileId { get; set; }
        public ScopeType? ScopeType { get; set; }
        public Guid? TeamId { get; set; }
        public Guid? BusinessUnitId { get; set; }
        public bool IncludeChildBusinessUnits { get; set; }

        public static ProfileScope FromEntity(Entity e) => new ProfileScope
        {
            Id = e.Id,
            ProfileId = e.GetAttributeValue<EntityReference>(Names.Scope.Profile)?.Id ?? Guid.Empty,
            ScopeType = (ScopeType?)e.GetAttributeValue<OptionSetValue>(Names.Scope.ScopeType)?.Value,
            TeamId = e.GetAttributeValue<EntityReference>(Names.Scope.Team)?.Id,
            BusinessUnitId = e.GetAttributeValue<EntityReference>(Names.Scope.BusinessUnit)?.Id,
            IncludeChildBusinessUnits = e.GetAttributeValue<bool>(Names.Scope.IncludeChildBusinessUnits)
        };
    }

    /// <summary>What the resolver needs to know about a user.</summary>
    public sealed class UserMembership
    {
        public UserMembership(Guid userId, Guid businessUnitId, IEnumerable<Guid> businessUnitAncestors, IEnumerable<Guid> teamIds)
        {
            UserId = userId;
            BusinessUnitId = businessUnitId;
            BusinessUnitAncestors = new HashSet<Guid>(businessUnitAncestors ?? new Guid[0]);
            TeamIds = new HashSet<Guid>(teamIds ?? new Guid[0]);
        }

        public Guid UserId { get; }
        public Guid BusinessUnitId { get; }
        /// <summary>Parent, grandparent, ... of the user's BU (not the BU itself).</summary>
        public ISet<Guid> BusinessUnitAncestors { get; }
        public ISet<Guid> TeamIds { get; }
    }

    /// <summary>Resolved value for one setting for one user.</summary>
    public sealed class EffectiveSetting
    {
        public EffectiveSetting(SettingDefinition definition, SettingMode mode, object value, SettingsProfile source)
        {
            Definition = definition;
            Mode = mode;
            Value = value;
            Source = source;
        }

        public SettingDefinition Definition { get; }
        public SettingMode Mode { get; }
        public bool Locked => Mode == SettingMode.Locked;
        /// <summary>Value typed for usersettings.</summary>
        public object Value { get; }
        public SettingsProfile Source { get; }
    }
}
