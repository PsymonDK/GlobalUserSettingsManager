using System.Collections.Generic;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Values
{
    /// <summary>
    /// "Load current values" (SPIKE G option 1): copy a user's current usersettings into a profile's value columns.
    /// Modes are never changed, so loading alone never changes what is rolled out. By default only settings the profile
    /// does not manage (mode Inherit) are filled; managed values are kept unless overwriteManaged is set.
    /// </summary>
    public static class CurrentValueLoader
    {
        public sealed class Result
        {
            /// <summary>Profile columns to write (no Id set).</summary>
            public Entity Update { get; } = new Entity(Names.Profile.Entity);
            public List<string> Loaded { get; } = new List<string>();
            public List<string> KeptManaged { get; } = new List<string>();
        }

        /// <param name="profile">Current profile row; null for a profile that does not exist yet (all Inherit).</param>
        /// <param name="userSettings">The source user's usersettings row (managed attributes).</param>
        public static Result Build(SettingsProfile profile, Entity userSettings, bool overwriteManaged)
        {
            var result = new Result();
            foreach (var d in SettingsRegistry.All)
            {
                if (!userSettings.Contains(d.Attribute) || userSettings[d.Attribute] == null) continue;
                var current = profile?.Get(d.Attribute);
                var mode = current?.Mode ?? SettingMode.Inherit;
                if (mode != SettingMode.Inherit && !overwriteManaged) { result.KeptManaged.Add(d.Attribute); continue; }

                var value = SettingValue.ToProfile(d, userSettings[d.Attribute]);
                if (SettingValue.AreEqual(value, current?.ProfileValue)) continue;
                result.Update[d.ValueColumn] = value;
                result.Loaded.Add(d.Attribute);
            }
            return result;
        }
    }
}
