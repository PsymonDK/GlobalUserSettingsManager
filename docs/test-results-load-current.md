# Test Results: Load current values

2026-11-25, shared dev environment, owner's own user only (pilot team "DUS Pilot" set on Global). Covers SPIKE G option 1 (decision 32).

| # | Case | Expected | Result |
|---|---|---|---|
| L1 | `jhrb_LoadCurrentSettings` with no input | Error "ProfileId or UserId is required." | Pass |
| L2 | `UserId` = own user, no User profile yet | User profile created; every non-null managed setting loaded (54 of 61); all modes Inherit; values equal current `usersettings` (`paginglimit` 50, `timezonecode` 105) | Pass |
| L3 | Same profile again | Loaded 0 (values already equal) | Pass |
| L4 | `paginglimit` set to Default, load again | Loaded 0, KeptManaged 1 | Pass |
| L5 | `OverwriteManaged` = true, values equal | Loaded 0 | Pass |
| L6 | `SourceUserId` with no `usersettings` row | Error "The user has no personal settings yet." | Pass |
| L7 | Form command bar (overflow menu): **Load current values** on the User profile, after changing one Inherit value | Confirm dialog names the user; notification "Loaded 1 value(s); kept 1 managed setting(s)"; form refreshed | Pass |
| L8 | Rollout side effects | Loading (Inherit values only) queued no job. Create and the two mode changes queued jobs that processed 1 user with 0 updates. Own settings unchanged | Pass |
| U | Unit tests (`CurrentValueLoaderTests`) | Type conversion, modes never written, managed kept unless overwrite, unchanged values skipped | Pass (41/41 total) |

Notes:
- The first UI attempt failed with "Cannot convert the literal 'undefined' to the expected type 'Edm.Guid'": `Xrm.WebApi.online.execute` needs Guid parameters as `{ guid: "..." }`. Fixed in the web resource.
- A new modern command can take a reload with a cleared command cache before it appears.
- Left in the environment: the owner's User profile, all settings Inherit (no effect).
