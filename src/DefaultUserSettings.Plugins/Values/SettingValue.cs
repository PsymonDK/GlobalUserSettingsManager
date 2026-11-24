using System;
using System.Globalization;
using DefaultUserSettings.Plugins.Registry;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Values
{
    /// <summary>Converts profile column values to usersettings values and compares them.</summary>
    public static class SettingValue
    {
        /// <summary>Profile column value -> value to write on usersettings. Null stays null.</summary>
        public static object ToUserSettings(SettingDefinition d, object profileValue)
        {
            if (profileValue == null) return null;
            switch (d.Kind)
            {
                case SettingKind.Integer: return Convert.ToInt32(profileValue, CultureInfo.InvariantCulture);
                case SettingKind.String: return (string)profileValue;
                case SettingKind.Boolean: return (bool)profileValue;
                case SettingKind.Choice: return new OptionSetValue(((OptionSetValue)profileValue).Value);
                case SettingKind.Lookup: return new EntityReference(d.LookupTarget, ((EntityReference)profileValue).Id);
                case SettingKind.GuidText: return ParseGuid(d, profileValue);
                case SettingKind.LookupText: return new EntityReference(d.LookupTarget, ParseGuid(d, profileValue));
                default: throw new NotSupportedException(d.Kind.ToString());
            }
        }

        /// <summary>usersettings value -> value for the profile column (reverse of ToUserSettings). Used to capture admin edits.</summary>
        public static object ToProfile(SettingDefinition d, object userSettingsValue)
        {
            if (userSettingsValue == null) return null;
            switch (d.Kind)
            {
                case SettingKind.Integer: return Convert.ToInt32(userSettingsValue, CultureInfo.InvariantCulture);
                case SettingKind.String: return (string)userSettingsValue;
                case SettingKind.Boolean: return (bool)userSettingsValue;
                case SettingKind.Choice: return new OptionSetValue(((OptionSetValue)userSettingsValue).Value);
                case SettingKind.Lookup: return new EntityReference(d.LookupTarget, ((EntityReference)userSettingsValue).Id);
                case SettingKind.GuidText: return ((Guid)userSettingsValue).ToString();
                case SettingKind.LookupText: return ((EntityReference)userSettingsValue).Id.ToString();
                default: throw new NotSupportedException(d.Kind.ToString());
            }
        }

        /// <summary>True if the profile value can be converted (used by validation).</summary>
        public static bool TryValidate(SettingDefinition d, object profileValue, out string error)
        {
            error = null;
            if (d.Kind != SettingKind.GuidText && d.Kind != SettingKind.LookupText) return true;
            if (profileValue is string s && Guid.TryParse(s, out _)) return true;
            error = $"'{d.Label}' must be a GUID.";
            return false;
        }

        /// <summary>Reduce any SDK value to a comparable primitive.</summary>
        public static object Normalize(object value)
        {
            switch (value)
            {
                case null: return null;
                case OptionSetValue o: return o.Value;
                case EntityReference r: return r.Id;
                case string s: return s.Length == 0 ? null : s;
                default: return value;
            }
        }

        public static bool AreEqual(object a, object b)
        {
            var na = Normalize(a);
            var nb = Normalize(b);
            if (na == null || nb == null) return na == null && nb == null;
            if (na is string sa && nb is string sb) return string.Equals(sa, sb, StringComparison.Ordinal);
            if (IsNumber(na) && IsNumber(nb)) return Convert.ToInt64(na, CultureInfo.InvariantCulture) == Convert.ToInt64(nb, CultureInfo.InvariantCulture);
            return na.Equals(nb);
        }

        public static string ToDisplay(object value)
        {
            var n = Normalize(value);
            if (n == null) return "(empty)";
            return Convert.ToString(n, CultureInfo.InvariantCulture);
        }

        private static bool IsNumber(object o) => o is int || o is long || o is short;

        private static Guid ParseGuid(SettingDefinition d, object profileValue)
        {
            if (profileValue is Guid g) return g;
            if (profileValue is string s && Guid.TryParse(s, out var parsed)) return parsed;
            throw new InvalidPluginExecutionException($"Profile value for '{d.Label}' is not a valid GUID.");
        }
    }
}
