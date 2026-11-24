# Default User Settings for Dataverse

Admins define default values for Dataverse personal settings (`usersettings`): time zone, formats, records per page, email options and about 60 more.
- Defaults are **rolled out** to existing users and **applied to new users**.
- They can be **grouped** by team and business unit, with priorities.
- They can be **locked**: when a user changes a locked setting in Personal Options, it is silently reverted.

Everything runs as C# plugins and Custom APIs, with no Power Automate.

- Design: [docs/build-plan.md](docs/build-plan.md). Sections 11 and 12 hold the current decisions.
- Decision log: [docs/decisions.md](docs/decisions.md).
- Phase 0 evidence: [docs/spike-findings.md](docs/spike-findings.md).
- Test results: [Phase 1](docs/test-results-phase1.md), [Phases 2-4](docs/test-results-phase2-4.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Spikes, settings shortlist | Done |
| 1 | Tables, registry, Global row, lock enforcement, validation, log | Done, integration tested |
| 2 | Rollout Custom API, chunked jobs, profile/scope change rollout, daily reconcile | Done, integration tested |
| 3 | New users (async + wait for the `usersettings` row, reconcile fallback) | Built. Not tested on a real new user (shared dev environment) |
| 4 | Team/BU membership triggers, per-user overrides, capture of admin edits | Built. Membership tested; the admin-edit capture needs a second user to test |
| 5 | Model-driven app, security roles, managed solution export | Built (see [Install](#install)) |

## How it works

### Profiles and layers

`jhrb_settingsprofile` holds one row per layer:

| Type | How many | Applies to |
|---|---|---|
| Global | exactly one | everyone in scope |
| Group | any; unique `jhrb_priority` | members of any of its scopes (`jhrb_profilescope`: a team, or a business unit optionally including child BUs) |
| User | one per user | that user (an override) |

Per setting, a row has a **value** column (`jhrb_<attribute>`) and a **mode** column (`jhrb_<attribute>_mode`):

- **Inherit:** this layer does not manage the setting. On Global, that means unmanaged.
- **Default:** apply the value; the user may change it afterwards.
- **Locked:** apply and enforce the value.

**Resolution, per setting:** User > Group (highest priority first) > Global. The first layer that is not Inherit supplies both the value and the lock. Priority is strict, so a higher layer may unlock a setting that a lower layer locks.

### Enforcement

A synchronous PreOperation plugin on `usersettings` Update is filtered to the managed attributes.
- **A user changes their own settings:** locked values are silently reverted and a `Revert` log row is written. Personal Options shows no error.
- **Someone else changes a user's settings** (an admin through the API or XrmToolBox): the change is kept and **captured into that user's override profile**, so later rollouts don't undo it. A `Manual` log row is written.
- **Rollout writes:** these are tagged and ignored.

### Rollout

Changes are applied by `jhrb_rolloutjob` rows. An async plugin processes users in chunks of about 90 seconds and continues itself until it's done, writing **only the attributes that differ**. Each write produces a log row with the old and new value.

| Trigger | Job |
|---|---|
| A value or mode changes on a profile | all users, **Full**, only the changed settings |
| A profile is activated, deactivated, reprioritized, created or deleted; a scope changes; the pilot team changes | all users, **Auto** |
| A team member is added or removed (Associate/Disassociate); a user's BU changes | that user, **Auto** |
| A new user | that user, **Auto**. Waits up to 60 s for `usersettings`, which can appear seconds after the user |
| Daily heartbeat (recurring bulk delete) or `jhrb_ReconcileSettings` | all users, **Auto**; also resumes stalled jobs |
| `jhrb_ApplyDefaults` | as requested |

Apply modes:
- **Full:** Default and Locked values.
- **LockedOnly:** locks only.
- **Auto:** Full for users whose layers changed or who were never initialized, LockedOnly for everyone else. A per-user fingerprint in `jhrb_userstate` makes this work. That way the reconcile catches membership changes Dataverse doesn't announce (`AddMembersTeam`, Entra group teams), without overwriting what users chose for Default settings.

### Scope, pilot and kill switch

- **Users in scope:** enabled, licensed, read-write access mode, and not application users.
- **Pilot mode:** if the Global row has a **pilot team**, only its members are enforced and rolled out.
- **Kill switch:** an **inactive** Global row turns everything off.

## Install

Prerequisites:
- PAC CLI, .NET SDK, and the Azure CLI signed in to the tenant. The scripts use `az account get-access-token`.
- A publisher with prefix `jhrb` (option value prefix 63249). To use your own publisher, change the prefix in the code and scripts.

```powershell
$env:DUS_ORG_URL = 'https://<org>.crm.dynamics.com'
pwsh scripts/Build-Schema.ps1                    # settings.json + SettingsRegistry.g.cs from schema/managed-settings.csv
dotnet build src/DefaultUserSettings.Plugins -c Release
dotnet test  src/DefaultUserSettings.Plugins.Tests
pwsh scripts/Deploy-Schema.ps1                   # solution DefaultUserSettings: tables, columns, choices
pwsh scripts/Register-Plugins.ps1                # assembly, 18 steps, 3 Custom APIs
pwsh scripts/Deploy-Security.ps1                 # roles: Default User Settings Admin / Reader
pwsh scripts/Deploy-App.ps1                      # model-driven app "Default User Settings"
pwsh scripts/Seed-GlobalProfile.ps1 -PilotMembers <your systemuserid>   # Global row + pilot team
pwsh scripts/Setup-Heartbeat.ps1                 # daily reconcile + 90-day log retention (bulk delete jobs)
pwsh scripts/Export-Solution.ps1                 # unmanaged + managed zips, unpacked source in solution/src
```

To install into another environment, import the managed solution, then run `Seed-GlobalProfile.ps1` and `Setup-Heartbeat.ps1` there.

## Use

1. Open the **Default User Settings** app, then **Settings Profiles** > **Global**. For each setting to manage, set a value and a mode.
2. For different defaults per audience:
   - Create a **Group** profile with a unique priority.
   - Add scopes (teams, business units).
   - Set only the settings that should differ from Global.
3. **Per-user exceptions:** create a **User** profile for that user. Alternatively, edit the user's settings directly (for example with XrmToolBox User Settings Utility), and the change is captured.
4. Watch **Rollout Jobs** and **Settings Logs**.
5. When ready, remove the pilot team from the Global row to go live for everyone.

### Custom APIs

| API | Inputs | Outputs |
|---|---|---|
| `jhrb_ApplyDefaults` | `Scope` (All / User), `UserId`, `Setting` (comma list), `ApplyMode` (Full / LockedOnly / Auto), `DryRun`, `IgnorePilot` (dry runs only), `BatchSize` | `JobId`, `Updated`, `Unchanged`, `Failed` |
| `jhrb_ReconcileSettings` | none | `JobId` |
| `jhrb_ResolveEffectiveSettings` | `UserId` (default: the caller) | `Settings` (JSON: value, mode, winning profile), `Layers`, `InScope` |

The rollout APIs need `prvCreatejhrb_RolloutJob`, which comes with the Admin role.

## Adding a setting

1. Add one line to `schema/managed-settings.csv`.
2. Run `Build-Schema.ps1`, `Deploy-Schema.ps1`, then `Deploy-App.ps1`.
3. Rebuild the plugins and run `Register-Plugins.ps1`, which also updates the step's filtering attributes.

## Troubleshooting

- **A setting is not reverted or not rolled out:**
  - Run `jhrb_ResolveEffectiveSettings` for the user and check `InScope`, the mode and the winning profile.
  - Check that the Global row is active and that the user is in the pilot team, if one is set.
- **A job is stuck in Pending:** long chains stop at the platform depth limit on purpose. The daily heartbeat, or `jhrb_ReconcileSettings`, resumes them.
- **A new user didn't get defaults:** if `usersettings` appeared more than 60 s after the user, the next reconcile applies them, because a user with no state row gets a Full apply.
- **Validation errors** ("Only one Global profile", "priority N", "has no value") come from the validation plugin and say what to fix.
- **Plugin trace:** enable the plugin trace log, then look for the `DefaultUserSettings.Plugins` types.

## Known limitations

- **Dataverse fires no event for `AddMembersTeam`/`RemoveMembersTeam`, `SetBusiness`, or Entra group team sync.** Locks still apply on the next edit, because the lock plugin resolves live membership. Defaults follow at the next reconcile (daily).
- **Block mode is not offered.** Personal Options shows no error and loses the whole save (SPIKE A2).
- **Some UI-only settings may behave differently on the new settings experience.** The integration tests used `paginglimit` and `advancedfindstartupmode`.

## Contributing

- Open a pull request against `main`. CI ([build.yml](.github/workflows/build.yml)) checks that the generated registry matches `schema/managed-settings.csv`, builds the plugin and runs the unit tests.
- Every pull request needs a review from a code owner ([CODEOWNERS](.github/CODEOWNERS)).
- The strong-name key (`DefaultUserSettings.Plugins.snk`) is committed on purpose. Strong naming gives the plugin assembly a stable identity, which Dataverse needs to treat a new build as an update. It is not a security boundary. Do not replace it.
- Branch protection for `main` is defined in [.github/rulesets/main.json](.github/rulesets/main.json): no force pushes or deletion, pull request with one code-owner approval, CI `build` must pass, and repository admins may merge their own pull requests. Apply it with:

  ```powershell
  gh api -X POST repos/{owner}/{repo}/rulesets --input .github/rulesets/main.json
  ```

## Licence

MIT. See [LICENSE](LICENSE).
