# Dataverse Default User Settings: Build Plan

Handoff document for Claude Code. Read fully before writing code. Items marked **SPIKE** are unverified assumptions; resolve them first (Phase 0) because they can change the design.

## 1. Goal

Let an admin define default values for Dataverse user settings (the `usersettings` table) that are:

1. Rolled out to all existing users.
2. Applied automatically to new users.
3. Optionally **locked** per setting. If a setting is not user-editable, any user change is reverted to the effective (resolved) value.
4. **Grouped**: different defaults per audience (Team membership, Business Unit, security role, later Entra group via group teams). See section 5.7.

Constraints already decided:

- All data changes done with **C# plugins / Custom APIs**. No Power Automate.
- Config stored in a Dataverse table that mirrors the shape of `usersettings` (one column per setting) plus a yes/no "user editable" column per setting.
- App UI is open: model-driven (possibly with PCF), generative page, or code app. See section 7.

## 2. Background facts

- `usersettings` is keyed by `systemuserid` (one row per user, 1:1 with `systemuser`).
- Per the Web API reference, it supports Retrieve/RetrieveMultiple and **Update**. There is no Create message. The platform creates the row.
- Not every attribute is writable. Check `IsValidForUpdate` per attribute via metadata before including it (section 4).
- Entity set: `usersettingscollection`. Logical name: `usersettings`.

## 3. Open design assumptions (confirm with the owner)

1. **Per-user rows.** Interpretation used here: one table, `Type` = `Global` or `User`. Exactly one `Global` row (the template/default). `User` rows are *optional admin overrides* for a specific user. No user row means follow global. If the owner instead wants a mirrored row for every user, only the creation logic in 5.5 changes. Ask before building override rows. They can be deferred to Phase 4.
2. **Lock behavior.** Silent revert at write time (plugin overwrites the value in the incoming Target) plus an audit log row. Alternative: throw `InvalidPluginExecutionException` so the user sees an error. Make this a config option on the global row (`RevertMode`: Silent | Block). Default Silent.
3. **Precedence.** Layered, per setting: Global < Group profiles (ascending priority) < User override. Effective value and lock come from the highest layer that has the setting enabled. See 5.7. (Supersedes the earlier "override else global" rule.)
4. **Groups are in scope** but built after the Global-only flow is proven (Phase 4). The data model reserves them from Phase 1 so no migration is needed.

## 4. Data model

Publisher prefix placeholder: `mus_` (replace). Solution name: `DefaultUserSettings`.

### 4.1 Table `mus_settingsprofile` (Settings Profile)

| Column | Type | Notes |
|---|---|---|
| `mus_name` | text | Primary name |
| `mus_type` | choice | Global / Group / User |
| `mus_priority` | whole number | Group rows only. Higher wins. Unique among Group rows (validated) |
| `mus_isactive` | two-option | Inactive profiles are ignored by the resolver |
| `mus_user` | lookup systemuser | User rows only |
| `mus_revertmode` | choice | Silent / Block (Global row only) |
| one column per managed setting | matches the usersettings attribute type | e.g. `mus_timezonecode` int |
| one `mus_<setting>_isuseredit` per setting | two-option (Yes/No) | Default Yes |
| `mus_<setting>_isenabled` | two-option | Whether this setting is managed at all. Unmanaged settings are never touched |

Rules:
- Alternate key / plugin validation: only one Global row; only one User row per user; Group priorities unique.
- Group membership rules live in child table `mus_profilescope` (4.4), not on this table.
- Do not hand-write the column list. **Generate** it: query `EntityDefinitions(LogicalName='usersettings')/Attributes`, keep attributes with `IsValidForUpdate = true`, and shortlist with the owner. Likely candidates: `timezonecode`, `localeid`, `uilanguageid`, `helplanguageid`, `dateformatstring`/`dateformatcode`, `timeformatstring`/`timeformatcode`, `dateseparator`, `decimalsymbol`, `numbergroupformat`, `currencyformatcode`, `currencydecimalprecision`, `negativecurrencyformatcode`, `negativeformatcode`, `numberseparator`, `defaultcalendarview`, `defaultdashboardid`, `defaultsearchexperience`, `entityformmode`, `isguidedhelpenabled`, `pagingLimit`, `incomingemailfilteringmethod`. Verify each exists and is writable in the target environment.
- Keep one static C# registry mapping `profile column -> usersettings attribute -> type -> locked flag column`. All plugin code reads this registry, so adding a setting means one registry line plus one column.

### 4.2 Table `mus_settingslog` (Audit / reverts)

Columns: user, setting, old value, attempted value, applied value, source (`Rollout` | `NewUser` | `Revert` | `Manual` | `GroupChange`), winning profile (lookup), timestamp. Lets admins see what was reverted and why. Use an elastic table with TTL of 90 days

### 4.3 Table `mus_rolloutjob` (chunked rollout, see 5.4)

Columns: status, scope (All | Setting | User | Profile), profile filter (for Profile scope), setting filter, cursor (last `systemuserid` processed), batch size, processed count, failed count, error text.

### 4.4 Table `mus_profilescope` (Group membership rules)

One row per rule; a Group profile has 1..n rules combined with **OR** (user matches the profile if any rule matches).

| Column | Type | Notes |
|---|---|---|
| `mus_profile` | lookup mus_settingsprofile | Parent, cascade delete |
| `mus_scopetype` | choice | Team / BusinessUnit (extensible; SecurityRole dropped per section 11) |
| `mus_team` | lookup team | When Team. Owner and access teams; Entra-group-backed teams work here too |
| `mus_businessunit` | lookup businessunit | When BusinessUnit |
| `mus_includechildbus` | two-option | BusinessUnit only: include child BUs (walk hierarchy) |
| `mus_securityrole` | lookup role | When SecurityRole |

Validation plugin: exactly one target lookup filled, matching `mus_scopetype`.

## 5. Plugin design (C#, one assembly, classic plugin assembly targeting .NET Framework 4.6.2 unless NuGet dependencies force a plugin package)

Shared code: `SettingsRegistry`, `ProfileResolver` (loads Global + optional User row, computes effective value and lock per setting; cache per plugin execution only, no static state), `SettingsWriter` (builds the `usersettings` Update; writes log).

Check official dataverse requirements before locking any versions.

### 5.1 Enforce locks: `usersettings` Update, **PreOperation, synchronous**

- For each registry setting present in `Target`: if enabled and not user-editable, **replace** the Target value with the effective value (Silent) or throw (Block).
- Skip if the calling user is the system/application user running rollout (mark rollout writes via `SharedVariables["mus_rollout"]=true`) or if `Depth > 1`.
- Write a log row for each revert.
- **SPIKE A:** Confirm a step can be registered on `usersettings` Update (message is listed as an event in docs) and that the personal options dialog and the Settings > Personal Options path both trigger it. Also test other paths that change user settings (for example timezone auto-set at first sign-in).

### 5.2 Apply to new users: `systemuser` Create, PostOperation

- Retrieve the user's `usersettings` row. If it exists, apply effective values (respect only enabled settings).
- **SPIKE B (most important):** Does the `usersettings` row exist at the moment `systemuser` Create completes (sync post-op)? If not, fallbacks in order of preference:
  1. Handle first `usersettings` Update (5.1 can detect a not-yet-initialized user by checking a marker column on the user's override row or log) and apply all defaults then.
  2. A plugin on `Retrieve`/`RetrieveMultiple` of `usersettings` (post-op) that applies defaults when a marker says the user has not been initialized. Verify cost and safety.
  3. A Custom API `mus_ReconcileSettings` an admin can run, and that can be triggered by a recurring system job if the environment has one. State clearly in the README which fallback was used.
- Mark initialization in the log (`source = NewUser`) so it only happens once.

### 5.3 Setting changes on the Global row: `mus_settingsprofile` Update, PostOperation, asynchronous

- Compare `PreImage` and `Target`. For settings whose **value changed**, create a rollout job for that setting. For settings whose lock flipped **No**, create a rollout job too, because existing users must be pulled back to the global value. Lock flipped to Yes needs no rollout.
- Never write `usersettings` inline here for large environments. Always create a job.

### 5.4 Rollout: Custom API `mus_ApplyDefaults` + chunking

- Parameters: `Scope` (All | User | Setting), `UserId` (optional), `Setting` (optional), `DryRun` (bool).
- Process in pages of N users (default 200) with `ExecuteMultipleRequest`. Respect plugin timeouts (2 minutes). Persist the cursor in `mus_rolloutjob`. When a chunk ends before finishing, the plugin creates a continuation job row (async plugin on `mus_rolloutjob` Create picks it up). Finish when the cursor reaches the end.
- Only update attributes whose current value differs from the effective value, to avoid pointless writes and audit noise.
- Skip disabled users and non-interactive/application users (`accessmode` filter). Confirm filter with the owner.
- Set `SharedVariables["mus_rollout"]` so 5.1 does not log these as reverts.
- Return counts: updated, unchanged, failed.

### 5.5 Optional: per-user override rows (Phase 4)

- User row Create/Update (post-op) applies that user's effective values immediately.
- User row Delete (post-op) re-applies the next layer's values (group, else global) for that user.

### 5.7 Grouped defaults (Team / Business Unit / Role)

**Idea:** a user override is just the top layer of one resolution chain. Layers, lowest to highest: `Global` < `Group` profiles (ascending `mus_priority`) < `User` override.

**Resolution (`ProfileResolver`, per user, per setting):**
1. Find applicable Group profiles: active profiles with at least one `mus_profilescope` rule matching the user.
   - Team: user is in `teammembership` for that team.
   - BusinessUnit: `systemuser.businessunitid` equals the BU, or is a descendant when `includechildbus`.
   - SecurityRole: user holds the role (direct or via team).
2. Walk layers from highest to lowest. First layer with `<setting>_isenabled = Yes` supplies **both** the value and the lock flag. A layer with it set to No inherits from below.
3. No layer enabled: setting is unmanaged, never touched.
4. Equal priority is prevented by validation. As a safety net the resolver breaks ties by `createdon` and the log records the winning profile.

**Lock semantics:** locked state follows the winning layer. Optional later extension: an `Enforced` flag on a layer that stops lower-priority-number layers above it from overriding (for example Global-enforced settings that no group may change). Not in v1.

**No materialized per-user cache in v1.** The resolver computes on the fly: one query for Global + active Group profiles with scopes (small, cacheable per execution), plus 2-3 membership lookups for the user. Rollout prefetches memberships per batch of users. Revisit only if the sync lock plugin (5.1) measures too slow.

**Triggers that change a user's effective values (all enqueue `mus_rolloutjob`, never write inline):**

| Event | Plugin step | Job |
|---|---|---|
| Group profile values/locks change | `mus_settingsprofile` Update, async (extends 5.3) | Scope=Profile, setting filter = changed settings |
| Group profile activated/deactivated/deleted, priority changed | same | Scope=Profile (all current members plus previous members) |
| `mus_profilescope` Create/Update/Delete | async | Scope=Profile |
| User added to / removed from a team | `Associate` / `Disassociate` on team-systemuser relationship, async | Scope=User |
| User moves BU | `systemuser` Update (`businessunitid`) or the BU-change message, async | Scope=User |
| Role assigned/removed | `Associate`/`Disassociate` on systemuserroles, async (only if SecurityRole scope is used) | Scope=User |
| New user | existing 5.2 | resolved through the same chain |
| Safety net | `mus_ReconcileSettings` Custom API, scheduled | Scope=All, dry-run diff first |

**Leaving a group:** the user is re-resolved, so managed settings fall back to the next layer (usually Global). Settings no layer manages keep the user's own value.

**Interaction with locks (5.1):** the sync PreOperation plugin resolves the user's effective values through the same chain, so a user in a group with a locked timezone gets reverted to the group's timezone, not Global's.

**Custom API `mus_ResolveEffectiveSettings`** (UserId): returns effective value, lock flag and winning profile per setting. Used by tests, the UI ("why does this user have this value?") and support.

**Performance note:** for a 10k-user environment, a Global change touches every user, a group change only its members. Chunking, cursor and `ExecuteMultipleRequest` from 5.4 apply unchanged; Scope=Profile just selects the user set from the scope rules.

**Alternative considered: dynamic rule engine** (FetchXML or expression per group). More flexible, but harder to validate, test and explain to admins, and membership changes could not be event-driven. Rejected for v1. Because `mus_profilescope` is a separate table with `scopetype`, adding a `FetchXml` scope type later is additive.

**Alternative considered: one winning profile per user instead of per-setting merge.** Simpler to reason about, but forces admins to duplicate every Global value into every group profile. Rejected. Per-setting inherit keeps group profiles small ("only timezone and date format for the Nordics team").

### 5.6 Cross-cutting

- Idempotent everywhere. Handle `Depth`, retries, and throttling (429) with backoff in rollout.
- No secrets, no external calls.
- Plugin step registration deployed via solution (use `pac plugin` / plugin registration through the solution, not manual steps).
- Security roles: `DUS Admin` (full on config tables, run the Custom API), `DUS Reader` (read Global row so UI can show locks to users if desired). Plugins execute as SYSTEM for the `usersettings` update, but verify the identity actually used works. **SPIKE C:** Confirm which user context can update another user's `usersettings` (impersonation vs system).

**Spikes added by grouping (Phase 0, in addition to A, B, C above):**

- **SPIKE D:** Which events fire when team membership changes? Test: admin adds user via UI, via `AddMembersTeam`, via Entra-group-backed team (membership synced at sign-in; likely no Associate event). If membership events are unreliable for group teams, the scheduled `mus_ReconcileSettings` plus a check on first `usersettings` Update becomes the primary path for those teams.
- **SPIKE E:** Which message fires when a user's business unit changes (`SetBusinessSystemUser` vs plain Update of `businessunitid`)? Register on both if needed.
- **SPIKE F:** Cost of resolving membership inside the sync PreOperation lock plugin. Measure; if too slow, add a per-user effective-settings cache table.

## 6. Testing

- Unit tests: registry, resolver, revert logic using FakeXrmEasy or XrmMockup (pick one and note it).
- Integration tests in a dev environment (script with `pac`/Web API):
  1. Unlocked setting: user changes it, value persists.
  2. Locked setting: user changes it, value is reverted, log row written.
  3. Lock flips to Yes then No: existing users are pulled to global.
  4. New user created: defaults applied (verify via SPIKE B path used).
  5. Rollout over 1,000+ synthetic users completes across chunks without timeouts.
  6. Rollout writes are not logged as reverts.
  7. Grouping: user in two groups, higher priority wins per setting; unset setting falls through to lower group, then Global.
  8. Grouping: user removed from team falls back to Global value; user moved to another BU gets that BU's values.
  9. Grouping: lock in a group profile reverts a user edit to the group value, log row names the winning profile.
  10. Grouping: BU rule with and without child BUs; role rule; Entra-group-backed team (per SPIKE D).
  11. Group profile edit rolls out to members only, not to other users.
- Unit tests for the resolver cover layer order, tie-break, inactive profile, no matching scope, and disabled setting.
- Include a test matrix document of results.

## 7. App options (decision gate after Phase 1)

| Option | Pros | Cons |
|---|---|---|
| **Model-driven app** (recommended start) | Fastest, native security and auditing, form sections per setting group | Looks plain |
| Model-driven + **PCF** | A "setting row" control showing value + lock toggle + "differs from default" indicator and rollout status looks much better | Extra build and maintenance |
| Generative page | Quick to prototype a nicer settings screen | Check current maturity/limits in your tenant before committing |
| Code app (embedded or standalone) | Full UI freedom | Most work, own auth/ALM considerations |

Recommendation: ship Phase 1 as a plain model-driven app so the plugins are provable, then build one PCF (or generative page) for the Global row editing experience: grouped settings, a lock toggle beside each value, a "Roll out now" button calling `mus_ApplyDefaults`, and a log/job view.

## 8. Phases

0. **Spikes (A, B, C)** and settings shortlist from live metadata. Output: short findings note, adjust design.
1. Solution skeleton: tables, registry, Global row, `usersettings` Update lock plugin (5.1), log table.
2. Rollout: Custom API, jobs, Global-row change plugin (5.3), tests.
3. New-user handling (5.2 using the approach SPIKE B allows).
4. Grouped defaults (5.7: Group profiles, `mus_profilescope`, membership triggers, `mus_ResolveEffectiveSettings`), then optional per-user overrides (5.5). Tables for both exist from Phase 1; resolver is written layer-aware from Phase 1 so this phase adds rules and triggers, not a rewrite.
5. UI polish (PCF/generative page), security roles, ALM (managed solution, pipeline), docs.

## 9. Deliverables

- Unmanaged + managed solution, source in repo (`pac solution unpack`).
- C# project(s) plus tests.
- `README.md`: install, configure Global row, how locks work, how to roll out, troubleshooting, which SPIKE B fallback is used.
- Test results note.

## 10. Questions for the owner (ask once, up front)

1. Per-user override rows needed, or global row only? (see section 3)
2. Silent revert or block with an error message?
3. Final shortlist of settings to manage.
4. Which users are in scope (exclude application/non-interactive users and disabled users?).
5. Single environment or deployed across several (affects ALM and environment variables)?
6. Group dimensions needed in v1: Team, Business Unit, Security Role, Entra group (via group team)? Any other (for example a user attribute like country or department)?
7. When a user is in several groups, is per-setting priority (proposed) acceptable, or must a user only ever be in one group?
8. Should a Global lock be able to forbid group overrides (the `Enforced` flag in 5.7)?

## 11. Owner decisions (2026-11-24, supersede earlier text where they conflict)

1. **Per-user editing: yes, and it must be easy.** Preferred UX: admin edits the user's values directly (ideally in the `usersettings` row itself). Design: when a `DUS Admin` (not the user themself) updates someone's `usersettings`, the lock plugin does not revert; instead it upserts that user's `User` profile row with the changed settings enabled, so the change survives later rollouts. Feasibility of showing/editing `usersettings` in a model-driven app is **SPIKE G**; fallback is editing the `User` profile row from the user's record.
2. **Silent revert** by default. **SPIKE A2:** test whether `InvalidPluginExecutionException` from the lock plugin produces a readable message in Personal Options (classic and new settings UI). If it does, switch default to **Block**.
3. **Manage all user-editable settings** (`IsValidForUpdate = true`, excluding system/internal ones found in Phase 0). With 3 columns per setting this may be several hundred columns: **SPIKE H** checks column count against table limits and decides between the mirrored-column model and a fallback (see spike findings).
4. **Scope: active licensed users.** Filter: `isdisabled = false`, `islicensed = true`, `accessmode` not Non-interactive (4) or Support (3), no `applicationid`. Confirm the exact list in Phase 0.
5. **Single environment.** No environment variables needed for multi-env; managed solution still used for clean install/uninstall.
6. **Group dimensions: Business Units and Teams only.** A single Group profile can cover several BUs and teams (multiple `mus_profilescope` rows, OR). SecurityRole scope type dropped.
7. **Scopes are prioritized** (`mus_priority`, unique).
8. **Follow priority strictly.** No `Enforced` flag. A higher layer may override and unlock a setting that Global locks.

## 12. Phase 0 outcome (see [spike-findings.md](spike-findings.md) for evidence)

- 5.2 new users: **async** `systemuser` Create creates a job that retries until `usersettings` exists (SPIKE B). No sync post-op.
- 5.7 triggers: `AddMembersTeam`/`RemoveMembersTeam` and `SetBusiness` fire no plugin events (SPIKE D/E). Locks stay correct because the lock plugin resolves live membership. Non-locked defaults are kept in sync by Associate/Disassociate events **plus a daily reconcile** started by a recurring bulk delete job on a `mus_heartbeat` row (no Power Automate).
- Lock plugin: **Silent revert only.** Block was tested in Personal Options: the dialog shows no error and the whole save is lost. `mus_revertmode` is dropped from v1. Revert only when a locked value actually differs (the dialog sends only changed fields).
- Per-user editing: User profile row with "Load current values" + capture of admin edits to another user's `usersettings` (SPIKE G: `usersettings` cannot be on a form).
- **Column model (owner confirmed 2026-11-24):** one `mus_<setting>_mode` choice (global choice `mus_settingmode`: Inherit / Default / Locked) per setting. It replaces the `_isenabled` and `_isuseredit` flags in 4.1. Inherit means "this layer does not manage the setting"; on the Global row that means unmanaged.
- New table: `mus_heartbeat` (scheduler trigger).

## 13. As built (2026-11-24)

The `mus_` prefix in this plan was a placeholder. The solution uses the owner's publisher **`jhrb`** (option prefix 63249). Every build decision is in [decisions.md](decisions.md). The main deviations from the sections above:

- Tables:
  - `jhrb_settingsprofile` (Global / Group / User) with one value column and one `_mode` column per setting.
  - `jhrb_profilescope` (Team / BU).
  - `jhrb_settingslog`: a **standard** table with daily 90-day retention.
  - `jhrb_rolloutjob`.
  - **`jhrb_userstate`** (new, holds each user's layer fingerprint).
  - **`jhrb_heartbeat`** (new).
- Rollout jobs have scope All or User, and apply modes **Full / LockedOnly / Auto** (decisions 11 to 15).
- `RevertMode` and Block were dropped (SPIKE A2).
- Admin edits of another user's settings are captured into that user's override row (decision 20).
- Pilot team and kill switch on the Global row (decision 8).
- UI: a generated model-driven app. PCF is still optional (plan section 7).
