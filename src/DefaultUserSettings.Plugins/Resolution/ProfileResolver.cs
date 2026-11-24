using System;
using System.Collections.Generic;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Values;

namespace DefaultUserSettings.Plugins.Resolution
{
    /// <summary>
    /// Layered resolution (plan 5.7): User override > Group profiles (higher priority first) > Global.
    /// Per setting, the first layer whose mode is not Inherit supplies both value and lock.
    /// Pure: no Dataverse calls, so it is unit tested directly.
    /// </summary>
    public static class ProfileResolver
    {
        /// <summary>Applicable active profiles for the user, highest precedence first.</summary>
        public static IList<SettingsProfile> Layers(IEnumerable<SettingsProfile> profiles, UserMembership user)
        {
            var active = profiles.Where(p => p.IsActive && p.Type.HasValue).ToList();

            var layers = new List<SettingsProfile>();
            layers.AddRange(active.Where(p => p.Type == ProfileType.User && p.UserId == user.UserId).Take(1));
            layers.AddRange(active
                .Where(p => p.Type == ProfileType.Group && Matches(p, user))
                .OrderByDescending(p => p.Priority ?? int.MinValue)
                .ThenBy(p => p.CreatedOn)       // tie-break safety net; validation prevents equal priorities
                .ThenBy(p => p.Id));
            layers.AddRange(active.Where(p => p.Type == ProfileType.Global).OrderBy(p => p.CreatedOn).Take(1));
            return layers;
        }

        public static bool Matches(SettingsProfile group, UserMembership user) =>
            group.Scopes.Any(s => Matches(s, user));

        public static bool Matches(ProfileScope scope, UserMembership user)
        {
            switch (scope.ScopeType)
            {
                case ScopeType.Team:
                    return scope.TeamId.HasValue && user.TeamIds.Contains(scope.TeamId.Value);
                case ScopeType.BusinessUnit:
                    if (!scope.BusinessUnitId.HasValue) return false;
                    var bu = scope.BusinessUnitId.Value;
                    return bu == user.BusinessUnitId || (scope.IncludeChildBusinessUnits && user.BusinessUnitAncestors.Contains(bu));
                default:
                    return false;
            }
        }

        /// <summary>Effective settings keyed by usersettings attribute. Unmanaged settings are absent.</summary>
        public static IDictionary<string, EffectiveSetting> Resolve(IEnumerable<SettingsProfile> profiles, UserMembership user)
        {
            var layers = Layers(profiles, user);
            var result = new Dictionary<string, EffectiveSetting>(StringComparer.OrdinalIgnoreCase);
            foreach (var d in SettingsRegistry.All)
            {
                foreach (var layer in layers)
                {
                    var s = layer.Get(d.Attribute);
                    if (s == null || s.Mode == SettingMode.Inherit) continue;
                    if (s.ProfileValue == null) break; // invalid row (validation blocks this); treat as unmanaged rather than write null
                    result[d.Attribute] = new EffectiveSetting(d, s.Mode, SettingValue.ToUserSettings(d, s.ProfileValue), layer);
                    break;
                }
            }
            return result;
        }

        /// <summary>
        /// Pilot mode: if the Global row names a pilot team, only its members are enforced/rolled out.
        /// No Global row, or an inactive one, means the feature is off.
        /// </summary>
        public static bool IsUserInScope(IEnumerable<SettingsProfile> profiles, UserMembership user)
        {
            var global = profiles.FirstOrDefault(p => p.Type == ProfileType.Global && p.IsActive);
            if (global == null) return false;
            return !global.PilotTeamId.HasValue || user.TeamIds.Contains(global.PilotTeamId.Value);
        }
    }
}
