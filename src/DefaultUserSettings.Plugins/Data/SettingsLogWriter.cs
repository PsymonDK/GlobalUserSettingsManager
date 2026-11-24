using System;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Values;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Data
{
    /// <summary>Writes jhrb_settingslog rows. Retention: a recurring bulk delete removes rows older than 90 days (Setup-Heartbeat.ps1).</summary>
    public sealed class SettingsLogWriter
    {
        private const int MaxText = 4000;
        private readonly IOrganizationService _svc;

        public SettingsLogWriter(IOrganizationService svc)
        {
            _svc = svc;
        }

        public void Write(Guid userId, SettingDefinition setting, LogSource source, object oldValue, object attempted, object applied, Guid? profileId)
        {
            var e = new Entity(Names.Log.Entity)
            {
                [Names.Log.Name] = Truncate($"{source}: {setting.Label}", 100),
                [Names.Log.User] = new EntityReference("systemuser", userId),
                [Names.Log.Setting] = setting.Attribute,
                [Names.Log.OldValue] = Truncate(SettingValue.ToDisplay(oldValue), MaxText),
                [Names.Log.AttemptedValue] = Truncate(SettingValue.ToDisplay(attempted), MaxText),
                [Names.Log.AppliedValue] = Truncate(SettingValue.ToDisplay(applied), MaxText),
                [Names.Log.Source] = new OptionSetValue((int)source)
            };
            if (profileId.HasValue) e[Names.Log.Profile] = new EntityReference(Names.Profile.Entity, profileId.Value);
            _svc.Create(e);
        }

        private static string Truncate(string s, int max) => s == null || s.Length <= max ? s : s.Substring(0, max);
    }
}
