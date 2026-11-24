using System.Collections.Generic;
using System.Linq;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Values;

namespace DefaultUserSettings.Plugins.Rollout
{
    /// <summary>What a profile change means for rollout (plan 5.3, adapted to the mode model).</summary>
    public sealed class ProfileChange
    {
        /// <summary>Settings whose value or mode changed: roll out Full for these.</summary>
        public List<string> ChangedSettings { get; } = new List<string>();
        /// <summary>Active flag, priority, type, user, pilot team changed, or the row was created/deleted: re-evaluate everyone (Auto).</summary>
        public bool Structural { get; set; }
        public bool Any => Structural || ChangedSettings.Count > 0;
    }

    public static class ChangeDetector
    {
        /// <param name="before">Null on Create.</param>
        /// <param name="after">Null on Delete.</param>
        public static ProfileChange Detect(SettingsProfile before, SettingsProfile after)
        {
            var change = new ProfileChange();
            if (before == null || after == null)
            {
                change.Structural = true;
                var row = after ?? before;
                change.ChangedSettings.AddRange(SettingsRegistry.All
                    .Where(d => (row.Get(d.Attribute)?.Mode ?? SettingMode.Inherit) != SettingMode.Inherit)
                    .Select(d => d.Attribute));
                return change;
            }

            change.Structural = before.IsActive != after.IsActive || before.Priority != after.Priority || before.Type != after.Type
                || before.UserId != after.UserId || before.PilotTeamId != after.PilotTeamId;

            foreach (var d in SettingsRegistry.All)
            {
                var b = before.Get(d.Attribute);
                var a = after.Get(d.Attribute);
                var bm = b?.Mode ?? SettingMode.Inherit;
                var am = a?.Mode ?? SettingMode.Inherit;
                if (bm == SettingMode.Inherit && am == SettingMode.Inherit) continue; // value edits on an unmanaged setting do nothing
                if (bm != am || !SettingValue.AreEqual(b?.ProfileValue, a?.ProfileValue)) change.ChangedSettings.Add(d.Attribute);
            }
            return change;
        }
    }
}
