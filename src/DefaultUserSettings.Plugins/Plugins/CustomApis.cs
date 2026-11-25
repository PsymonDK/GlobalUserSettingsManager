using System;
using System.Linq;
using System.Text;
using DefaultUserSettings.Plugins.Data;
using DefaultUserSettings.Plugins.Model;
using DefaultUserSettings.Plugins.Resolution;
using DefaultUserSettings.Plugins.Rollout;
using DefaultUserSettings.Plugins.Values;
using Microsoft.Xrm.Sdk;

namespace DefaultUserSettings.Plugins.Plugins
{
    /// <summary>
    /// Custom API jhrb_ApplyDefaults (plan 5.4).
    /// In: Scope ("All" | "User", default All), UserId (Guid), Setting (comma list), DryRun (bool), ApplyMode ("Full" | "LockedOnly" | "Auto", default Full),
    ///     IgnorePilot (bool, dry runs only), BatchSize (int), ChunkSeconds (int, time budget per execution).
    /// Out: JobId (Guid), Updated, Unchanged, Failed (int). User scope runs inline and returns counts; All scope queues a job (counts on the job row).
    /// </summary>
    public sealed class ApplyDefaultsApi : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var p = local.Context.InputParameters;
            string S(string k) => p.Contains(k) ? p[k] as string : null;
            bool B(string k) => p.Contains(k) && p[k] is bool b && b;

            var scope = "User".Equals(S("Scope"), StringComparison.OrdinalIgnoreCase) ? JobScope.User : JobScope.All;
            var mode = Enum.TryParse<ApplyMode>(S("ApplyMode") ?? "Full", true, out var m) ? m : ApplyMode.Full;
            var userId = p.Contains("UserId") && p["UserId"] is Guid g && g != Guid.Empty ? g : (Guid?)null;
            if (scope == JobScope.User && !userId.HasValue) userId = local.Context.InitiatingUserId;
            var filter = RolloutPlanner.ParseFilter(S("Setting"));
            var batch = p.Contains("BatchSize") && p["BatchSize"] is int bs && bs > 0 ? bs : 200;
            var chunk = p.Contains("ChunkSeconds") && p["ChunkSeconds"] is int cs && cs > 0 ? cs : (int?)null;

            local.Context.SharedVariables[Names.SharedVariableRollout] = true;
            if (scope == JobScope.User)
            {
                var r = new RolloutProcessor(local.SystemService, local.Trace).Run(new JobSpec
                {
                    Scope = JobScope.User, Mode = mode, UserId = userId, SettingFilter = filter, DryRun = B("DryRun"), LogSource = LogSource.Manual
                }, TimeSpan.FromSeconds(100));
                local.Context.OutputParameters["JobId"] = Guid.Empty;
                local.Context.OutputParameters["Updated"] = r.Updated;
                local.Context.OutputParameters["Unchanged"] = r.Unchanged;
                local.Context.OutputParameters["Failed"] = r.Failed;
                return;
            }

            var id = JobService.Create(local.SystemService, $"Manual rollout ({mode}{(B("DryRun") ? ", dry run" : "")})", JobScope.All, mode, JobReason.Manual,
                null, null, filter, B("DryRun"), B("IgnorePilot"), batch, chunk);
            local.Context.OutputParameters["JobId"] = id;
            local.Context.OutputParameters["Updated"] = 0;
            local.Context.OutputParameters["Unchanged"] = 0;
            local.Context.OutputParameters["Failed"] = 0;
        }
    }

    /// <summary>Custom API jhrb_ReconcileSettings. Out: JobId. Same as the daily heartbeat.</summary>
    public sealed class ReconcileSettingsApi : PluginBase
    {
        protected override void Execute(LocalContext local) =>
            local.Context.OutputParameters["JobId"] = Reconcile.Run(local.SystemService);
    }

    /// <summary>
    /// Custom API jhrb_LoadCurrentSettings ("Load current values", SPIKE G option 1). Copies a user's current usersettings into a profile's
    /// value columns. Modes are not changed, so loading alone rolls nothing out; the admin then sets Default or Locked where wanted.
    /// In: ProfileId (Guid) or UserId (Guid: that user's User profile, created if missing), SourceUserId (Guid, default: the profile's
    ///     user for User profiles, else the caller), OverwriteManaged (bool: also replace values of settings on Default/Locked).
    /// Out: ProfileId (Guid), Loaded (int: value columns written), KeptManaged (int: managed settings left as they were).
    /// </summary>
    public sealed class LoadCurrentSettingsApi : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var p = local.Context.InputParameters;
            Guid? G(string k) => p.Contains(k) && p[k] is Guid g && g != Guid.Empty ? g : (Guid?)null;
            var profileId = G("ProfileId");
            var userId = G("UserId");
            var overwrite = p.Contains("OverwriteManaged") && p["OverwriteManaged"] is bool b && b;
            var repo = new SettingsRepository(local.SystemService);

            SettingsProfile profile;
            Guid sourceUserId;
            if (profileId.HasValue)
            {
                profile = repo.LoadProfile(profileId.Value)
                    ?? throw new InvalidPluginExecutionException("The settings profile does not exist.");
                sourceUserId = G("SourceUserId") ?? (profile.Type == ProfileType.User && profile.UserId.HasValue ? profile.UserId.Value : local.Context.InitiatingUserId);
            }
            else if (userId.HasValue)
            {
                profile = repo.FindUserProfile(userId.Value);
                sourceUserId = G("SourceUserId") ?? userId.Value;
            }
            else throw new InvalidPluginExecutionException("ProfileId or UserId is required.");

            var userSettings = repo.LoadUserSettings(sourceUserId)
                ?? throw new InvalidPluginExecutionException("The user has no personal settings yet. Try again in a minute.");
            var r = CurrentValueLoader.Build(profile, userSettings, overwrite);

            Guid id;
            if (profile == null)
            {
                id = repo.CreateUserProfile(userId.Value, r.Update);
            }
            else
            {
                id = profile.Id;
                if (r.Loaded.Count > 0)
                {
                    r.Update.Id = id;
                    local.SystemService.Update(r.Update);
                }
            }
            local.Trace.Trace("Loaded {0} value(s) from user {1} into profile {2}; kept {3} managed.", r.Loaded.Count, sourceUserId, id, r.KeptManaged.Count);
            local.Context.OutputParameters["ProfileId"] = id;
            local.Context.OutputParameters["Loaded"] = r.Loaded.Count;
            local.Context.OutputParameters["KeptManaged"] = r.KeptManaged.Count;
        }
    }

    /// <summary>
    /// Custom API jhrb_ResolveEffectiveSettings (function). In: UserId (Guid, default caller).
    /// Out: Settings (JSON array: setting, label, value, mode, source, sourceId), Layers (JSON array of profile names in precedence order), InScope (bool).
    /// </summary>
    public sealed class ResolveEffectiveSettingsApi : PluginBase
    {
        protected override void Execute(LocalContext local)
        {
            var p = local.Context.InputParameters;
            var userId = p.Contains("UserId") && p["UserId"] is Guid g && g != Guid.Empty ? g : local.Context.InitiatingUserId;
            var repo = new SettingsRepository(local.SystemService);
            var profiles = repo.LoadProfilesForUser(userId);
            var membership = repo.LoadMembership(userId);
            var effective = ProfileResolver.Resolve(profiles, membership);

            var sb = new StringBuilder("[");
            foreach (var e in effective.Values.OrderBy(v => v.Definition.Attribute))
            {
                if (sb.Length > 1) sb.Append(',');
                sb.Append('{')
                  .Append("\"setting\":").Append(Json(e.Definition.Attribute)).Append(',')
                  .Append("\"label\":").Append(Json(e.Definition.Label)).Append(',')
                  .Append("\"value\":").Append(Json(SettingValue.ToDisplay(e.Value))).Append(',')
                  .Append("\"mode\":").Append(Json(e.Mode.ToString())).Append(',')
                  .Append("\"source\":").Append(Json(e.Source.Name)).Append(',')
                  .Append("\"sourceId\":").Append(Json(e.Source.Id.ToString()))
                  .Append('}');
            }
            sb.Append(']');
            local.Context.OutputParameters["Settings"] = sb.ToString();
            local.Context.OutputParameters["Layers"] = "[" + string.Join(",", ProfileResolver.Layers(profiles, membership).Select(l => Json(l.Name))) + "]";
            local.Context.OutputParameters["InScope"] = ProfileResolver.IsUserInScope(profiles, membership);
        }

        internal static string Json(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder("\"");
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }
    }
}
