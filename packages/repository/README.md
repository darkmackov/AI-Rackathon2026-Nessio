# repository (stream D)

The only module that talks to IRIS. `CaseRepository` is the port, `InMemoryRepository` the fake (used by tests and the API today), `IrisRepository` stores app state in relational IRIS SQL tables generated from the contracts (the handover as one JSON document; data-model.md › Non-FHIR storage) and projects to FHIR R4 (EU/CZ) per docs/data-model.md; SQL `VECTOR` chunks in Phase 2. Connection settings (`IrisSettings`) come from each dev's `.env`.

**Done when:**
- [x] `IrisRepository` passes the same tests as the fake (`ONKO_TEST_IRIS=1`, tests/test_contract.py)
- [x] `Provenance` written for AI values and validations (adapters/fhir.py)
- [x] MDT record stored (`app_mdt_record`), the rendered conclusion PDF attached to its FHIR `DocumentReference` (S5)
- [ ] Phase 2: vector chunks + search
