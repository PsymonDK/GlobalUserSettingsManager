using System;
using System.Collections.Generic;
using System.Linq;

namespace DefaultUserSettings.Plugins.Registry
{
    /// <summary>How a setting is stored on the profile row and written to usersettings.</summary>
    public enum SettingKind
    {
        Integer,    // whole number -> int
        String,     // text -> string
        Boolean,    // yes/no -> bool
        Choice,     // local choice (options copied from usersettings) -> OptionSetValue
        Lookup,     // lookup -> EntityReference
        GuidText,   // text holding a GUID -> Guid (usersettings uniqueidentifier, e.g. defaultdashboardid)
        LookupText  // text holding a GUID -> EntityReference (target a custom lookup cannot point at, e.g. solution)
    }

    public sealed class SettingDefinition
    {
        public SettingDefinition(string attribute, string valueColumn, string modeColumn, SettingKind kind, string lookupTarget, string label)
        {
            Attribute = attribute;
            ValueColumn = valueColumn;
            ModeColumn = modeColumn;
            Kind = kind;
            LookupTarget = lookupTarget;
            Label = label;
        }

        /// <summary>usersettings attribute logical name.</summary>
        public string Attribute { get; }
        /// <summary>jhrb_settingsprofile column holding the value.</summary>
        public string ValueColumn { get; }
        /// <summary>jhrb_settingsprofile choice column holding the SettingMode.</summary>
        public string ModeColumn { get; }
        public SettingKind Kind { get; }
        public string LookupTarget { get; }
        public string Label { get; }
    }

    /// <summary>
    /// The one place that lists managed settings. Entries are generated into SettingsRegistry.g.cs.
    /// Immutable, so the static lookup tables are safe across plugin executions.
    /// </summary>
    public static partial class SettingsRegistry
    {
        // Assigned in the static constructor: field initializer order across partial files is undefined.
        private static readonly Dictionary<string, SettingDefinition> _byAttribute;

        static SettingsRegistry()
        {
            _byAttribute = _all.ToDictionary(s => s.Attribute, StringComparer.OrdinalIgnoreCase);
        }

        public static IReadOnlyList<SettingDefinition> All => _all;

        public static bool TryGet(string usersettingsAttribute, out SettingDefinition definition) =>
            _byAttribute.TryGetValue(usersettingsAttribute, out definition);

        public static bool IsManaged(string usersettingsAttribute) => _byAttribute.ContainsKey(usersettingsAttribute);

        /// <summary>All profile columns (values and modes), for queries.</summary>
        public static IEnumerable<string> ProfileColumns() =>
            _all.SelectMany(s => new[] { s.ValueColumn, s.ModeColumn });
    }
}
