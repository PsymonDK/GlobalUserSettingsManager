using System;
using System.Linq;
using DefaultUserSettings.Plugins.Data;
using DefaultUserSettings.Plugins.Enforcement;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Registry;
using DefaultUserSettings.Plugins.Resolution;
using DefaultUserSettings.Plugins.Values;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Plugins
{
    /// <summary>
    /// usersettings Update, PreOperation (20), synchronous, filtered to managed attributes. Plan 5.1 + owner decision 1.
    /// - User edits own settings: locked values are silently reverted (logged as Revert).
    /// - Someone else edits a user's settings directly (admin via API/XrmToolBox, Depth 1): not reverted; the change is
    ///   captured into the user's override profile so later rollouts keep it (logged as Manual).
    /// - Rollout writes (tagged) and nested plugin writes: ignored.
    /// </summary>
    public sealed class LockEnforcementPlugin : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var ctx = local.Context;
            if (ctx.MessageName != "Update" || ctx.PrimaryEntityName != Names.UserSettings.Entity || ctx.Stage != 20) return;

            var target = local.Target;
            if (target == null || !LockEnforcer.TouchesManagedSetting(target)) return;
            if (local.IsRollout()) { local.Trace.Trace("Rollout write, skipped."); return; }

            var userId = target.Id;
            var repo = new SettingsRepository(local.SystemService);
            var profiles = repo.LoadProfilesForUser(userId);
            if (!profiles.Any()) return;
            var membership = repo.LoadMembership(userId);
            if (!ProfileResolver.IsUserInScope(profiles, membership)) { local.Trace.Trace("User not in scope (no active Global row or not in pilot team)."); return; }
            var effective = ProfileResolver.Resolve(profiles, membership);

            if (ctx.InitiatingUserId != userId)
            {
                if (ctx.Depth > 1) return;
                Capture(local, userId, target, profiles, effective);
                return;
            }

            var reverts = LockEnforcer.Enforce(target, effective);
            if (reverts.Count == 0) return;
            var log = new SettingsLogWriter(local.SystemService);
            foreach (var r in reverts)
            {
                local.Trace.Trace("Reverted {0} to locked value from profile {1}.", r.Effective.Definition.Attribute, r.Effective.Source.Name);
                log.Write(userId, r.Effective.Definition, LogSource.Revert, null, r.Attempted, r.Effective.Value, r.Effective.Source.Id);
            }
        }

        /// <summary>Upsert the user's override row with the admin's values (mode Locked if the effective value was locked, else Default).</summary>
        private static void Capture(LocalContext local, Guid userId, Entity target,
            System.Collections.Generic.IList<SettingsProfile> profiles, System.Collections.Generic.IDictionary<string, EffectiveSetting> effective)
        {
            var userRow = profiles.FirstOrDefault(p => p.Type == ProfileType.User && p.UserId == userId);
            var row = new Entity(Names.Profile.Entity);
            var log = new SettingsLogWriter(local.SystemService);
            var captured = 0;
            foreach (var attribute in target.Attributes.Keys)
            {
                if (!SettingsRegistry.TryGet(attribute, out var d)) continue;
                var value = target[attribute];
                effective.TryGetValue(attribute, out var eff);
                if (eff != null && SettingValue.AreEqual(value, eff.Value)) continue;
                if (value == null) continue;
                row[d.ValueColumn] = SettingValue.ToProfile(d, value);
                row[d.ModeColumn] = new OptionSetValue((int)(eff?.Locked == true ? SettingMode.Locked : SettingMode.Default));
                log.Write(userId, d, LogSource.Manual, eff?.Value, value, value, userRow?.Id);
                captured++;
            }
            if (captured == 0) return;

            if (userRow != null)
            {
                row.Id = userRow.Id;
                local.SystemService.Update(row);
            }
            else
            {
                var user = local.SystemService.Retrieve("systemuser", userId, new Microsoft.Xrm.Sdk.Query.ColumnSet("fullname"));
                row[Names.Profile.Name] = $"User: {user.GetAttributeValue<string>("fullname")}";
                row[Names.Profile.Type] = new OptionSetValue((int)ProfileType.User);
                row[Names.Profile.User] = new EntityReference("systemuser", userId);
                row[Names.Profile.IsActive] = true;
                local.SystemService.Create(row);
            }
            local.Trace.Trace("Captured {0} admin-edited setting(s) into the user's override profile.", captured);
        }
    }
}
