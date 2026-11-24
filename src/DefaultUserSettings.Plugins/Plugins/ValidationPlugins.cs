using System;
using DefaultUserSettings.Plugins.Data;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Validation;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Plugins
{
    /// <summary>jhrb_settingsprofile Create/Update, PreValidation (10), synchronous. Update step needs PreImage "PreImage" (all columns).</summary>
    public sealed class ProfileValidationPlugin : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var merged = Merge(local.PreImage(), local.Target);
            var candidate = SettingsProfile.FromEntity(merged);
            if (candidate.Type == ProfileType.Global && string.IsNullOrWhiteSpace(candidate.Name))
                local.Target[Names.Profile.Name] = "Global";

            var others = candidate.Type.HasValue
                ? new SettingsRepository(local.SystemService).LoadProfilesOfType(candidate.Type.Value)
                : new SettingsProfile[0];
            var errors = ProfileValidator.Validate(candidate, others);
            if (errors.Count > 0) throw new InvalidPluginExecutionException(string.Join(Environment.NewLine, errors));
        }

        internal static Entity Merge(Entity pre, Entity target)
        {
            var e = new Entity(target.LogicalName, target.Id);
            if (pre != null) foreach (var a in pre.Attributes) e[a.Key] = a.Value;
            foreach (var a in target.Attributes) e[a.Key] = a.Value;
            return e;
        }
    }

    /// <summary>jhrb_profilescope Create/Update, PreValidation (10), synchronous. Update step needs PreImage "PreImage".</summary>
    public sealed class ScopeValidationPlugin : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var scope = ProfileScope.FromEntity(ProfileValidationPlugin.Merge(local.PreImage(), local.Target));
            var parentType = scope.ProfileId == Guid.Empty ? null : new SettingsRepository(local.SystemService).GetProfileType(scope.ProfileId);
            var errors = ProfileValidator.Validate(scope, parentType);
            if (errors.Count > 0) throw new InvalidPluginExecutionException(string.Join(Environment.NewLine, errors));
        }
    }
}
