# messaging (stream C)

MDT result delivery to the GP's in-app inbox, receipts (*Potvrzuji převzetí*), in-app deadline notifications (Q-F17), and patient notices that are recorded but never actually sent (`simulated=True`, Q-F16). Phase 2: request/reply flows for additional documents (Q-F23; in the MVP requests are tasks in `cases`), the reviewing-doctor feed (Q-F10).

**Done when:**
- [x] in-app inbox (MDT results) persisted
- [x] a receipt closes the case
- [x] simulated patient notices recorded
