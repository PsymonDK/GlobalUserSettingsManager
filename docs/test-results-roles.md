# Test results: admin role without System Administrator

Date: 2026-11-26. Dev environment. `scripts/Test-RoleAccess.ps1 -AsUser <id>` replays what the generative pages read,
write and call, through Web API impersonation (`MSCRMCallerID`), as a licensed user with **Basic User + Default User
Settings Admin** (plus an unrelated app access role) and no System Administrator. The user is not in the pilot team, and
every job only touched the pilot (the owner). Page rendering itself is not covered: no second interactive account was
available.

`WhoAmI` ignores `MSCRMCallerID`, so the script checks impersonation through `createdby` on the row it creates, and
privilege errors name the impersonated user.

| # | Check | Result |
|---|---|---|
| R2–R6 | User search, retrieve, pilot team count (lambda filter), team and business unit search | Pass |
| R7 | Another user's `usersettings` (Basic User grants org-wide read) | Pass |
| R8–R12 | Profiles with mode and value columns, scopes, rollout jobs, activity log (elastic) | Pass |
| R13–R15 | Page lookup by name (`uxagentproject`), page files (`uxagentprojectfile`), app module | Pass |
| A1–A4 | `jhrb_ResolveEffectiveSettings`, `jhrb_ApplyDefaults` (dry run, own user), `jhrb_ReconcileSettings`, `jhrb_LoadCurrentSettings` (own override) | Pass |
| W1–W2 | Create and update a group profile (created by the impersonated user) | Pass |
| W3 | Add a team scope | **Failed first:** missing `prvAppendToTeam`. Pass after the role fix (the role had to be removed and re-added on the user to refresh its privilege cache) |
| W4 | Remove the scope | Pass |
| W5 | Delete the group profile | Pass (see the race below) |
| W6 | Cancel a rollout job | Pass |

Final run: 23 passed, 0 failed. Afterwards the two roles were removed from the test user again. Only the Global row
and the owner's override remain, with no scopes, no open jobs, and no job that updated or failed.

Not covered: page rendering and navigation in the browser as that user, and adding a business unit scope (the
privilege is in the role, but there is no run for it).

## Role fix

The Admin role had no AppendTo on the lookup targets. Basic User has none on team or business unit and only
business-unit depth on user. `Deploy-Security.ps1` now adds `prvAppendToTeam`, `prvAppendToBusinessUnit`,
`prvAppendToUser` and `prvAppendToTransactionCurrency` at organization depth. These cover team and BU scopes, the pilot
team on the Global row, user overrides for any user, and currency values.

## Race: deleting a profile right after changing it

The first run deleted the group a second after creating and updating it, and the delete failed with a SQL constraint
error (`jhrb_settingsprofile_jhrb_rolloutjob_Profile`). The profile change plugin is asynchronous: it was still inserting
a rollout job that references the profile while the delete removed the links. The same delete succeeded once those jobs
were queued. This is not about roles (it would hit a System Administrator the same way). The script now waits for the
profile's jobs before it deletes.

Fix: `deleteProfile` in the generative pages and in the code app retries up to five times, 3 seconds apart, when the
error is that constraint. If it still fails, the dialog says the profile's rollout jobs are still being queued instead
of showing the SQL message. Verified on the deployed Profiles page: a script kept inserting finished rollout jobs that
referenced a test group (72 in 15 seconds) while the group was deleted from the editor. The first three DELETEs
returned 400 with the constraint error and the fourth succeeded; the page returned to the overview. The filler jobs and
the group were removed afterwards. The code app change is built but not pushed to dev.

Not covered: the model-driven form's own Delete button on a profile record. It can still show the SQL message in this
window; retrying the delete after a few seconds works.
