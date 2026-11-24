# Phase 0 Spike Findings

> Historical note: the spikes ran under the placeholder prefix `mus_`. The solution now uses the `jhrb` publisher, so `jhrb_` replaces `mus_` everywhere else.

Environment: a shared Dataverse dev environment, 2026-11-24. Tests ran on the spike owner's own user only (owner decision). The spike probe lives in [spikes/](../spikes/) and is registered in the unmanaged solution `DUSSpike` (publisher `DefaultUserSettings`, prefix `mus`). Raw metadata is in [phase0/metadata/](phase0/metadata/).

Status legend: **Confirmed** = observed in this environment. **Partial** = observed for one path, others untested. **Open** = needs a UI test or another user.

## Summary

| Spike | Question | Result | Design impact |
|---|---|---|---|
| A | Custom step on `usersettings` Update? | **Confirmed** for API and Personal Options. The dialog sends **only changed fields** | 5.1 as planned |
| A (silent) | Can PreOperation overwrite Target? | **Confirmed** in API and UI: user picked a value, saved, reopened the dialog and saw the locked value, no error | **Silent revert is the default** |
| A2 | Readable error with Block? | API: message returned verbatim. **Personal Options: no error shown at all**: the dialog closes as if saved, and the whole save (including unlocked changes) is lost | **Block rejected** for Personal Options. Keep Silent (owner rule, section 11) |
| B | `usersettings` exists at `systemuser` Create? | **Not reliably**: created 0 to 19 s *after* the user for about half of users | Do not use sync post-op. Use async + retry (below) |
| C | Which context can write another user's `usersettings`? | **Confirmed**: plugin `CreateOrganizationService(null)` (SYSTEM) can update a user's settings; `modifiedonbehalfby` = initiating user; nested call has `Depth = 2` | Rollout runs as SYSTEM |
| D | Do team membership changes fire events? | **Partial / important**: `Associate`/`Disassociate` (`teammembership_association`) fire for `$ref` requests **and for the team form's "Add Existing User"**. **`AddMembersTeam`/`RemoveMembersTeam` (API) change membership but fire no plugin event**, and those messages accept no custom steps. Entra-group team sync: untested | Membership changes cannot be fully event-driven. Add a scheduled reconcile (below) |
| E | Event on business unit change? | `SetBusiness` (systemuser) **does not allow custom steps**. Whether `systemuser` Update with `businessunitid` fires: **Open** (testing it means moving a user, which strips their roles; not done on own user) | Treat as not event-driven until tested |
| F | Cost of resolving membership in sync lock plugin | **Confirmed**: user BU + BU hierarchy walk + team memberships = 36 to 100 ms warm, 340 to 560 ms cold | No cache table needed. Resolve on the fly |
| G | Can admins edit `usersettings` in a model-driven app? | **No**: `usersettings` is not customizable (no forms, views, columns; not in Advanced Find). Editing via API works | Per-user editing goes through the User profile row (below) |
| H | Column count if all user-editable settings are managed | 141 attributes, 102 `IsValidForUpdate`. About 60 are real user preferences after removing system/internal ones | Fits easily. See column model below |

## Details and decisions

### A / A2: lock enforcement

- Silent revert: PreOperation sets `Target[attr] = effective`. PostOperation saw the reverted value and the stored row matched. Works.
- Block: `InvalidPluginExecutionException` text is returned verbatim to the API caller (`0x80040265`).
- **Catch:** a throw cancels the whole request. If a user changes an unlocked setting and a locked one in the same save, both are lost. The final plugin must only throw when the locked attribute's **value differs** from the effective value (presence alone is not enough, because the dialog may send unchanged fields).
- **UI test result:** Personal Options (Settings > Personal Settings, classic dialog) sends only changed attributes. With Block, the save was rejected but the dialog closed with no message, so users would believe they had saved. Decision: **Silent revert**. A `RevertMode` option is not needed in v1. Users can be told about locks elsewhere (for example a read-only "managed settings" page).

### B: new users

The `usersettings` row is often created seconds after `systemuser`, and `usersettings` has no Create message for custom steps.
**Decision:** `systemuser` Create, **PostOperation async** -> create `mus_rolloutjob` (Scope=User). The job retries (up to N times with backoff) while `usersettings` is missing. The daily reconcile (below) is the safety net. Also, on a user's first `usersettings` Update the lock plugin already applies the correct effective values for locked settings.

### C: execution identity

SYSTEM context works and is the identity for rollout. `modifiedonbehalfby` keeps the initiator for audit.
**Open:** an admin (not SYSTEM) updating *another* user's settings directly through the API. Not tested (own-user only). It matters for the "admin edits usersettings directly" capture path below.

### D / E: membership changes are only partly observable

- Observable: `Associate`/`Disassociate` on `teammembership_association`.
- Observable from the UI: the team form's "Add Existing User" fires `Associate`.
- Not observable: `AddMembersTeam`/`RemoveMembersTeam` (owner-team API, used by scripts and integrations) and `SetBusiness`. Entra-group team sync is untested and may use the unobservable path.

**Decision (replaces the "all event-driven" table in plan 5.7):**
1. **Locks are always correct**: the lock plugin resolves live membership on every user-initiated `usersettings` Update (cost is F), so a user in a locked group is reverted to the right group value whether or not an event fired.
2. **Proactive rollout of non-locked defaults** after membership changes: event-driven where an event exists (Associate/Disassociate) + **scheduled reconcile**.
3. **Scheduler without Power Automate:** a recurring **bulk delete job** (`BulkDeleteRequest` with `RecurrencePattern = FREQ=DAILY`) that deletes a dummy `mus_heartbeat` row. An async plugin on `mus_heartbeat` Delete (or on the job's Create of a new heartbeat row) starts a Scope=All reconcile. This is a supported platform feature, needs no flows, and runs daily. Cheap because rollout only writes differing attributes.
4. Optional later: store a per-user membership fingerprint (hash of BU + team IDs) on the log/override row to skip unchanged users in reconcile.

### F: performance

36 to 100 ms warm for the full membership resolution. Well inside sync plugin budgets. No effective-settings cache table in v1.

### G: per-user editing (owner wants "easy, ideally edit usersettings directly")

`usersettings` cannot be put on a model-driven form or view. Options, in order of recommendation:
1. **User profile row** (`mus_settingsprofile`, Type=User) on a form with a "Load current values" command that copies the user's current `usersettings` into the row. Save -> plugin applies immediately (5.5).
2. **Capture direct edits**: when someone with `DUS Admin` updates *another* user's `usersettings` through the API or a tool such as XrmToolBox *User Settings Utility*, the lock plugin does not revert. It upserts that user's User profile row with the changed settings enabled, so later rollouts keep the admin's change. (Depends on the open part of C.)
3. Later, if wanted: a custom page or PCF that edits `usersettings` live through the Web API.

### H: settings shortlist and column model

Keep (user preferences shown in Personal Options, about 60): `timezonecode`, `localeid`, `uilanguageid`, `helplanguageid`, `calendartype`, `dateformatcode`, `dateformatstring`, `longdateformatcode`, `dateseparator`, `timeformatcode`, `timeformatstring`, `timeseparator`, `amdesignator`, `pmdesignator`, `showweeknumber`, `workdaystarttime`, `workdaystoptime`, `defaultcalendarview`, `decimalsymbol`, `numberseparator`, `numbergroupformat`, `negativeformatcode`, `currencyformatcode`, `currencysymbol`, `currencydecimalprecision`, `negativecurrencyformatcode`, `pricingdecimalprecision`, `transactioncurrencyid`, `fullnameconventioncode`, `paginglimit`, `defaultdashboardid`, `defaultsearchexperience`, `entityformmode`, `displaydensity`, `homepagearea`, `homepagesubarea`, `homepagelayout`, `advancedfindstartupmode`, `visualizationpanelayout`, `isguidedhelpenabled`, `defaultcountrycode`, `isdefaultcountrycodecheckenabled`, `incomingemailfilteringmethod`, `ignoreunsolicitedemail`, `isemailconversationviewenabled`, `issendasallowed`, `autocreatecontactonpromote`, `isautodatacaptureenabled`, `isresourcebookingexchangesyncenabled`, `usecrmformforappointment`, `usecrmformforcontact`, `usecrmformforemail`, `usecrmformfortask`, `synccontactcompany`, `outlooksyncinterval`, `offlinesyncinterval`, `addressbooksyncinterval`, `reportscripterrors`, `datavalidationmodeforexporttoexcel`, `releasechannel`, `preferredsolution`.

Exclude (system, derived or UI state): `businessunitid`, `ownerid`, `owneridtype`, all `timezonebias`/`timezonedaylight*`/`timezonestandard*` (derived from `timezonecode`), `lastalertsviewedtime`, `lastmodifiedtimeforviewpersonalizationsettings`, `modellicenseenforcement*`, `nexttrackingnumber`, `trackingtokenid`, `resourcebookingexchangesyncversion`, `d365autoinstallattemptstatus`, `personalizationsettings`, `trytogglesets`, `trytogglestatus`, `tablescopeddvsearch*`, `isappsforcrmalertdismissed`, `getstartedpanecontentenabled`, `selectedglobalfilterid`, `splitviewstate`, `useimagestrips`, `userprofile`, `autocaptureuserstatus`, `isduplicatedetectionenabledwhengoingonline`.

To verify during Phase 1: that writing `timezonecode` alone recalculates the bias fields; that `defaultdashboardid`/`preferredsolution`/`transactioncurrencyid` behave as lookups that must exist in the environment.

**Column model recommendation:** replace the two yes/no flags per setting (`_isenabled` + `_isuseredit`) with **one choice column per setting**, `mus_<setting>_mode` = *Inherit / Default (user may change) / Locked*. That is about 60 x 2 = 120 columns instead of 180. It is the same information with no invalid combination ("not enabled but locked"), and it reads better on the form. The registry maps value column + mode column. **Owner to confirm** (the original constraint said a yes/no "user editable" column).

### Scope of users (owner answer 4)

The population in this environment shows `accessmode`: 0 Read-Write, 1 Administrative, 3 Support, 4 Non-interactive (213 rows, all with `applicationid`), 5 Delegated Admin. Filter: `isdisabled eq false and islicensed eq true and accessmode eq 0` plus `applicationid eq null`. This gives 130 users here. `accessmode 1` (Administrative, 5 unlicensed users here) is excluded because they are unlicensed.

## Still open (needs your action)

1. ~~UI tests~~: done (see A, A2, D).
2. **E**: BU-change event. Needs a non-admin test user who can be moved between BUs.
3. **C (admin path)**: an admin updating another user's settings. Needs a second test user.
4. **B on a real new user**: optional; the async + retry design does not depend on it.

## Spike cleanup

Done 2026-11-24 with [spikes/remove-spike.ps1](../spikes/remove-spike.ps1). The raw log (27 rows) was exported first to [phase0/spike-log.json](phase0/spike-log.json). Removed: `DUSSpike` solution, table `mus_spikelog`, assembly `Mus.SpikeProbe` and its 6 steps, team `DUS Spike Team`. Kept: publisher `DefaultUserSettings` (prefix `mus`, option prefix 72100) for the real solution. The owner's own settings are back to their original values (`paginglimit` 50, Advanced Find mode Simple).
