# repository (stream D)

The only module that talks to IRIS. `CaseRepository` is the port, `InMemoryRepository` the fake (used by tests and the API today), `IrisRepository` maps to FHIR R4 (EU/CZ) per docs/data-model.md, plus SQL `VECTOR` chunks.

**Done when:**
- [ ] `IrisRepository` passes the same tests as the fake
- [ ] `Provenance` written for AI values and validations
- [ ] vector chunks + search
