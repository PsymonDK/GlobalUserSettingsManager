using System.Collections.Generic;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Values;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Enforcement
{
    public sealed class RevertAction
    {
        public RevertAction(EffectiveSetting effective, object attempted)
        {
            Effective = effective;
            Attempted = attempted;
        }

        public EffectiveSetting Effective { get; }
        public object Attempted { get; }
    }

    /// <summary>Silent revert (plan section 12): overwrite locked attributes in Target with the effective value.</summary>
    public static class LockEnforcer
    {
        /// <summary>Cheap pre-check before any query: does the Target touch a managed attribute?</summary>
        public static bool TouchesManagedSetting(Entity target) =>
            target.Attributes.Keys.Any(SettingsRegistry.IsManaged);

        public static IList<RevertAction> Enforce(Entity target, IDictionary<string, EffectiveSetting> effective)
        {
            var reverts = new List<RevertAction>();
            foreach (var attribute in target.Attributes.Keys.ToList())
            {
                if (!effective.TryGetValue(attribute, out var eff) || !eff.Locked) continue;
                var attempted = target[attribute];
                if (SettingValue.AreEqual(attempted, eff.Value)) continue;
                target[attribute] = eff.Value;
                reverts.Add(new RevertAction(eff, attempted));
            }
            return reverts;
        }
    }
}
