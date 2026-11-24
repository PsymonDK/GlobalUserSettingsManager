# Test Matrix

How each requirement in plan section 6 is covered. Detailed results are in `test-results-phase1.md` (Phase 1) and `test-results-phase2-4.md` (Phases 2 to 4), both written by the test scripts.

| Plan 6 item | Covered by | Status |
|---|---|---|
| Unit: registry, resolver, revert logic | `src/DefaultUserSettings.Plugins.Tests` (37 tests: resolver layers and scopes, enforcer, validators, planner, change detector, value conversion) | Pass |
| 1. Unlocked setting: user change persists | T1, R3 | Pass |
| 2. Locked setting: change reverted, log row written | T2, T2b, T3 | Pass |
| 3. Lock flips: existing users pulled to global | R6 (Default to Locked pulls the user back) | Pass |
| 4. New user gets defaults | Not run: needs a new licensed user in the shared environment. The design does not depend on timing (job waits 60 s; reconcile catches the rest) | **Open** |
| 5. Rollout over 1,000+ users across chunks | R11: dry run over all 130 licensed users at 20 users/page, 1 s/chunk, forcing continuations. No environment with 1,000+ users was available | Partial |
| 6. Rollout writes not logged as reverts / not captured | R1b (logged as Rollout), R2 (no override row created) | Pass |
| Grouping 7: priority per setting, fall-through | T4, T5, T5b, unit tests | Pass |
| Grouping 8: leave team -> Global; move BU | R7, R8 (team). BU move not run: SPIKE E, would move a user and strip their roles | Partial |
| Grouping 9: group lock reverts, log names winning profile | T4 | Pass |
| Grouping 10: BU rule with and without children; Entra group team | T5 (BU), unit tests (child BUs). Entra group team not available | Partial |
| Grouping 11: group edit only affects members | By construction: an All job with diff-only writes. R1 and R6 show updated=1 with only the pilot user in scope | Pass (indirect) |
| Membership change without event (AddMembersTeam) | R9 (reconcile with fingerprint) | Pass |
| Reconcile keeps users' own Default choices | R5 | Pass |
| Custom APIs | R4 (ApplyDefaults, User scope), R10 (Resolve), R5/R9 (Reconcile), R11 (ApplyDefaults, All, dry run) | Pass |
| Heartbeat (daily reconcile without Power Automate) | R12 (one-off bulk delete -> Delete plugin -> reconcile job + new heartbeat row) | Pass |
| Validation (one Global, unique priority, value required, scope only on groups) | T7 to T7d | Pass |
| Kill switch (inactive Global) | T8 | Pass |
| Admin edit captured into the override row | Needs a second user (owner limited testing to their own user) | **Open** |
