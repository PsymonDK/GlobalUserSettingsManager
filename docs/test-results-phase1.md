# Phase 1 Integration Test Results

Environment: the dev environment. Run: 2026-11-24 17:23. Test user: the caller (own user, pilot team member).

| Id | Test | Result | Detail |
|---|---|---|---|
| T1 | Default (unlocked): user change persists | PASS | paginglimit=75 |
| T2 | Locked: user change reverted silently | PASS | paginglimit=50 |
| T2b | Locked: revert logged | PASS | log: paginglimit 100->50 source=632490002 |
| T3 | Locked, same value: no log row | PASS |  |
| T4 | Group (team scope) lock wins over Global | PASS | paginglimit=25, log profile=889d7944-23e8-f111-84ea-0022489d55b0 |
| T5 | Higher-priority BU group (Default) unlocks: change persists | PASS | paginglimit=100 |
| T5b | Higher group set to Inherit: lower group lock applies again | PASS | paginglimit=25 |
| T6 | Inactive group ignored: Global lock applies | PASS | paginglimit=50 |
| T7 | Validation: second Global rejected | PASS | {"error":{"code":"0x80040265","message":"Only one Global profile is allowed."}} |
| T7b | Validation: duplicate group priority rejected | PASS | {"error":{"code":"0x80040265","message":"Another Group profile already uses priority 20. Priorities must be unique."}} |
| T7c | Validation: Locked without value rejected | PASS | {"error":{"code":"0x80040265","message":"'Time Zone' is set to Locked but has no value."}} |
| T7d | Validation: scope on Global rejected | PASS | {"error":{"code":"0x80040265","message":"Scopes can only be added to Group profiles."}} |
| T8 | Inactive Global row: nothing enforced | PASS | paginglimit=100 |
