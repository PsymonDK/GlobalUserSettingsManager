# Test results: generative pages

Date: 2026-11-26. Dev environment, own user only (the pilot team contains only the owner). PAC CLI 2.14.1.

## Spike (page removed afterwards)

| # | Check | Result |
|---|---|---|
| S1 | `dataApi.queryTable` on the elastic table `jhrb_settingslog` with `orderBy: createdon desc` | Pass |
| S2 | OData lambda filter `teammembership_association/any(...)` on `systemuser` | Pass |
| S3 | Counting 130 licensed users by paging (`hasMoreRows` / `loadMoreRows`), as there is no `$count` | Pass |
| S4 | `usersettings` and `jhrb_settingsprofile` reads; lookups come back as `/<table>(<guid>)` with a `lookuplogicalname` annotation | Pass |
| S5 | `dataApi.executeAction` for a bound Global Custom API | **Fails:** `not_bound`, and `listBoundActions()` returns `[]`, although the downloaded `config.json` holds the binding |
| S6 | `Xrm.WebApi.online.execute` from the page document for the same API | Pass (fallback in `shared/env.ts`) |

## Pages

| # | Check | Result |
|---|---|---|
| G1 | `Deploy-GenPages.ps1`: build, type-check, four uploads, pages added to the solution, sitemap group "Settings manager" with four entries | Pass |
| G2 | Profiles: pilot banner, 1 of 130 licensed in scope, 4 reverts, profile table, recent rollouts, most reverted setting | Pass |
| G3 | Profile editor opened in-page from the table, back to the overview | Pass |
| G4 | "Find a user" opens the Users page (`navigateTo` by page name) | Pass |
| G5 | Users: search, select own user, layers and in-scope from `jhrb_ResolveEffectiveSettings` (fallback path), recent changes | Pass |
| G6 | Layer link opens the Profiles page straight into the override editor (`pageInput.data.profileId`) | Pass |
| G7 | Load current values (`jhrb_LoadCurrentSettings` with a Guid parameter, fallback path): confirm dialog inside the page, notice, dialog closes | Pass |
| G8 | Own override: Time Zone to Default (value 105 = current), Save: `updateRow`, rollout job queued, completed with 0 updated. Back to Inherit and saved; checked through the Web API | Pass |
| G9 | Rollouts: job list and details; Roll out now as a dry run (`jhrb_ApplyDefaults`); polling starts while the job is pending | Pass |
| G10 | Activity log from the sitemap; source filter dropdown renders inside the page and filters to 4 reverts | Pass |

## Group, scope and delete flows (2026-11-26)

| # | Check | Result |
|---|---|---|
| G11 | New group profile "DUS Test group": priority suggested (10), created, editor opens on it; job "Create of profile" processed 1, updated 0 | Pass |
| G12 | Applies to: add team DUS Pilot (team search, pick, Add); "Applies to (1)"; job processed 1, updated 0 | Pass |
| G13 | Applies to: switch type to Business unit, search, pick the root BU, Include child business units, Add; row shows "Included"; job processed 1 (pilot), updated 0 | Pass |
| G14 | Remove both scopes; "No scopes yet"; two "Delete of scope" jobs processed 1, updated 0 | Pass |
| G15 | Deep link `pagetype=genux&...&data={"data":{"profileId":...}}` opens the editor | Pass |
| G16 | Delete the group: confirm, back to the overview without the group; job "Delete of profile" processed 1, updated 0; no profile, scope or log row left behind | **Failed first**, then pass after the fix |

G16 failed at first: clicking Delete in the confirm dialog did nothing. The sticky footer bar ("All changes saved") had `z-index: 1` and covered the dialog's buttons where they overlapped (seen with `document.elementFromPoint`). Fixed by removing the footer's z-index, so dialogs, which portal into the page root after it, paint on top. The Load current values dialog had worked only because its buttons sat higher on the page.

Seen once, not reproduced: a mouse click on the "Business unit" option in the scope type dropdown did not select it; the keyboard (ArrowDown, Enter) did.

Not tested: Go live (would affect all users), Apply now, Cancel job, Reconcile from the pages, dark theme (the app theme is light), narrow widths, and users without System Administrator (the Admin role may need read access to `uxagentproject` for page-to-page navigation).
