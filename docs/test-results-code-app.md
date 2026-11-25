# Test Results: Admin code app

2026-11-25, shared dev environment, app version 0.1.1, owner's own user only (pilot team "DUS Pilot" on Global). Browser: the Power Apps web player.

| # | Case | Result |
|---|---|---|
| C1 | Build: `tsc -b && vite build`, ESLint | Pass |
| C2 | Profiles: lists Global and the user-override summary; pilot banner shows the team name and member count (1); licensed count 130; reverts in the last 7 days (4) and most reverted setting | Pass |
| C3 | Profile editor (Global): groups, search, Managed only, mode switch shows the value editor (number input, yes/no switch), unsaved counter, Discard. Nothing saved on Global | Pass |
| C4 | Users: search by name, layers (User override > Global), in-scope badge, recent changes from the log | Pass |
| C5 | Edit override opens the owner's User profile; Records Per Page set to Default and saved; success notice; rollout job queued | Pass |
| C6 | Rollouts: the new job appears as Pending, the page polls and shows it Completed (1 processed, 0 updated); Cancel job disabled for finished jobs | Pass |
| C7 | Effective settings with two managed settings (Locked integer, Default yes/no): value, mode, source and "Matches" against the user's current values | Pass |
| C8 | Embedded: `?embed=1&user=<id>` and `?id={<id>}&typename=systemuser` show only the user view, without the top bar and navigation | Pass |
| C9 | Dark theme toggle | Pass |

Side effects: every test job finished with 0 writes; the owner's settings did not change. All test modes were set back to Inherit.

Not tested (would change other users or need data the environment lacks): New group profile, scopes (Applies to), Roll out now and Reconcile from the app, Go live, Delete, Load current values from the app (the API itself is covered in `test-results-load-current.md`), Activity log source filter, Choice and lookup value editors.

Notes:
- The web player keeps the previous version cached after a push and offers "Refresh" in a banner.
- Screenshots right after a state change sometimes showed the command bar in its previous state; a second capture was correct.
