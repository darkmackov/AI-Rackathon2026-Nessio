# repository (stream D)

The only module that talks to IRIS. `CaseRepository` is the port, `InMemoryRepository` the fake (used by tests and the API today), `IrisRepository` maps to FHIR R4 (EU/CZ) per docs/data-model.md; SQL `VECTOR` chunks in Phase 2. Connection settings (`IrisSettings`) come from each dev's `.env`.

**Done when:**
- [ ] `IrisRepository` passes the same tests as the fake
- [ ] `Provenance` written for AI values and validations
- [ ] Phase 2: vector chunks + search
