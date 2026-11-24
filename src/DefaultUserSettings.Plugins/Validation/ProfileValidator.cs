using System.Collections.Generic;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Values;

namespace DefaultUserSettings.Plugins.Validation
{
    public static class ProfileValidator
    {
        /// <param name="candidate">The row as it will be after the save (Target merged over PreImage).</param>
        /// <param name="others">Other profiles of the same type (excluding the candidate).</param>
        public static IList<string> Validate(SettingsProfile candidate, IEnumerable<SettingsProfile> others)
        {
            var errors = new List<string>();
            var rest = others.Where(o => o.Id != candidate.Id).ToList();

            switch (candidate.Type)
            {
                case null:
                    errors.Add("Type is required.");
                    break;
                case ProfileType.Global:
                    if (candidate.UserId.HasValue) errors.Add("A Global profile cannot have a user.");
                    if (rest.Any(o => o.Type == ProfileType.Global)) errors.Add("Only one Global profile is allowed.");
                    break;
                case ProfileType.Group:
                    if (candidate.UserId.HasValue) errors.Add("A Group profile cannot have a user.");
                    if (!candidate.Priority.HasValue) errors.Add("Priority is required for Group profiles.");
                    else if (rest.Any(o => o.Type == ProfileType.Group && o.Priority == candidate.Priority))
                        errors.Add($"Another Group profile already uses priority {candidate.Priority}. Priorities must be unique.");
                    break;
                case ProfileType.User:
                    if (!candidate.UserId.HasValue) errors.Add("User is required for User profiles.");
                    else if (rest.Any(o => o.Type == ProfileType.User && o.UserId == candidate.UserId))
                        errors.Add("This user already has a User profile.");
                    break;
            }

            if (candidate.Type != ProfileType.Global && candidate.PilotTeamId.HasValue)
                errors.Add("Pilot team can only be set on the Global profile.");

            foreach (var d in SettingsRegistry.All)
            {
                var s = candidate.Get(d.Attribute);
                if (s == null || s.Mode == SettingMode.Inherit) continue;
                if (s.ProfileValue == null || (s.ProfileValue is string str && str.Length == 0))
                {
                    errors.Add($"'{d.Label}' is set to {s.Mode} but has no value.");
                    continue;
                }
                if (!SettingValue.TryValidate(d, s.ProfileValue, out var error)) errors.Add(error);
            }
            return errors;
        }

        public static IList<string> Validate(ProfileScope scope, ProfileType? parentType)
        {
            var errors = new List<string>();
            if (scope.ProfileId == System.Guid.Empty) errors.Add("Profile is required.");
            else if (parentType != ProfileType.Group) errors.Add("Scopes can only be added to Group profiles.");

            switch (scope.ScopeType)
            {
                case ScopeType.Team:
                    if (!scope.TeamId.HasValue) errors.Add("Team is required for a Team scope.");
                    if (scope.BusinessUnitId.HasValue) errors.Add("A Team scope cannot have a business unit.");
                    break;
                case ScopeType.BusinessUnit:
                    if (!scope.BusinessUnitId.HasValue) errors.Add("Business unit is required for a Business Unit scope.");
                    if (scope.TeamId.HasValue) errors.Add("A Business Unit scope cannot have a team.");
                    break;
                default:
                    errors.Add("Scope type is required.");
                    break;
            }
            return errors;
        }
    }
}
