# cases (stream C)

State machine (8 states), dashboard queue column with the manual on-hold flag (Q-F9), who is on the move / next step, tasks with dependencies (incl. request tasks linked to findings via `Task.finding_id`), task sets (user data, edited in the UI), time to treatment T1+T2+T3 (Q-F18), audit, and the MDT (`mdt.py`, S5): snapshot, MDT record, conclusion edit windows and confirmation.

**Done when:**
- [x] transitions, queue + on hold, next step, task-set instantiation, time to treatment
- [ ] audit log
- [ ] deadline / overdue notifications
- [ ] persistence through the repository
- [x] MDT snapshot, record and conclusion rules (S5, Q-F34–Q-F39)
