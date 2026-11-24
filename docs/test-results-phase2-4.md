# Phase 2-4 Integration Test Results

Run: 2026-11-24 17:47. Test user: the caller (only pilot team member). Dry run R11 reads all licensed users.

| Id | Test | Result | Detail |
|---|---|---|---|
| R1 | Global Default change rolls out to existing users | PASS | paginglimit=50 [Change of paginglimit in profile 'Global': status=632490002 processed=1 updated=1 failed=0 chunks=1] |
| R1b | Rollout logged with old and applied value | PASS | log paginglimit 75->50 |
| R2 | Rollout writes are not captured as admin edits (tag works) | PASS | override rows=0 |
| R3 | After rollout, Default setting is still user-editable | PASS | paginglimit=100 |
| R4 | jhrb_ApplyDefaults Scope=User applies inline | PASS | paginglimit=50 response updated=1  |
| R5 | Reconcile does not overwrite user-changed Default when layers unchanged | PASS | paginglimit=100 [Daily reconcile 2026-11-24: status=632490002 processed=1 updated=0 failed=0 chunks=1]  |
| R6 | Default->Locked change pulls users to the locked value | PASS | paginglimit=50 [Change of paginglimit in profile 'Global': status=632490002 processed=1 updated=1 failed=0 chunks=1] |
| R7 | Joining a team applies that group's defaults (Associate event) | PASS | paginglimit=25 [Team membership associate: status=632490002 processed=1 updated=1 failed=0 chunks=1] |
| R8 | Leaving the team falls back to Global defaults | PASS | paginglimit=50 [Team membership disassociate: status=632490002 processed=1 updated=1 failed=0 chunks=1] [Team membership associate: status=632490002 processed=1 updated=1 failed=0 chunks=1] |
| R9 | AddMembersTeam (no event) is picked up by reconcile | PASS | before reconcile=50 after=25 [Daily reconcile 2026-11-24: status=632490002 processed=1 updated=1 failed=0 chunks=1] |
| R10 | jhrb_ResolveEffectiveSettings returns value, mode and source | PASS | paginglimit=50/Default/Global layers=["Global"]  |
| R11 | Chunked dry run (20 users/page, 1 s/chunk) continues across executions, no writes | PASS | [Manual rollout (Full, dry run): status=632490002 processed=130 updated=1 failed=0 chunks=2]  |
| R12 | Bulk delete of heartbeat starts reconcile and re-creates heartbeat | PASS | [Daily reconcile 2026-11-24: status=632490002 processed=1 updated=1 failed=0 chunks=1] new heartbeat rows=1 |
