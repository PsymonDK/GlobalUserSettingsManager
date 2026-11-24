using System;
using System.Collections.Generic;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Resolution;
using DefaultUserSettings.Plugins.Values;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Rollout
{
    public sealed class AttributeChange
    {
        public AttributeChange(EffectiveSetting effective, object oldValue)
        {
            Effective = effective;
            OldValue = oldValue;
        }

        public EffectiveSetting Effective { get; }
        public object OldValue { get; }
    }

    public sealed class UserPlan
    {
        public Guid UserId { get; set; }
        /// <summary>Mode actually used for this user (Auto resolved to Full or LockedOnly).</summary>
        public ApplyMode EffectiveMode { get; set; }
        public string Fingerprint { get; set; }
        public List<AttributeChange> Changes { get; } = new List<AttributeChange>();
        /// <summary>True when a full apply happened, so the user's state row should be written.</summary>
        public bool WriteState => EffectiveMode == ApplyMode.Full;

        public Entity ToUpdate()
        {
            var e = new Entity(Names.UserSettings.Entity, UserId);
            foreach (var c in Changes) e[c.Effective.Definition.Attribute] = c.Effective.Value;
            return e;
        }
    }

    /// <summary>Pure: decides what to write for one user. Only differing attributes are written.</summary>
    public static class RolloutPlanner
    {
        /// <summary>Applicable layers in precedence order. Changes when membership, priority or overrides change.</summary>
        public static string Fingerprint(IList<SettingsProfile> layers) =>
            string.Join(",", layers.Select(l => l.Id.ToString("N")));

        public static UserPlan Plan(
            Guid userId,
            IEnumerable<SettingsProfile> profiles,
            UserMembership membership,
            Entity currentSettings,
            ApplyMode mode,
            ISet<string> settingFilter,
            string storedFingerprint)
        {
            var layers = ProfileResolver.Layers(profiles, membership);
            var plan = new UserPlan { UserId = userId, Fingerprint = Fingerprint(layers) };
            plan.EffectiveMode = mode != ApplyMode.Auto
                ? mode
                : (storedFingerprint == null || storedFingerprint != plan.Fingerprint ? ApplyMode.Full : ApplyMode.LockedOnly);

            var effective = ProfileResolver.Resolve(profiles, membership);
            foreach (var eff in effective.Values)
            {
                if (settingFilter != null && settingFilter.Count > 0 && !settingFilter.Contains(eff.Definition.Attribute)) continue;
                if (plan.EffectiveMode == ApplyMode.LockedOnly && !eff.Locked) continue;
                var current = currentSettings.Contains(eff.Definition.Attribute) ? currentSettings[eff.Definition.Attribute] : null;
                if (SettingValue.AreEqual(current, eff.Value)) continue;
                plan.Changes.Add(new AttributeChange(eff, current));
            }
            return plan;
        }

        public static ISet<string> ParseFilter(string filter) =>
            new HashSet<string>((filter ?? string.Empty).Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries), StringComparer.OrdinalIgnoreCase);
    }
}
