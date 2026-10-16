# AI rules: contracts (`onko_contracts`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** Shared domain models (`onko_contracts`). They are also the API's response models (docs/api.md).

**May depend on:** pydantic only.

**Rules:**
- Domain models: follow DM-1 … DM-13 in data.md. Subclass `Model`, plain names, stable enum values.
- `Sourced` provenance is enforced here: `origin=ai` needs evidence, `origin=manual` needs `entered` (DM-8, Q-A2). Keep the validators.
- These models are the API's responses, so a change here changes the web client: keep slice response models stable (APIM-4).
- Any change here is its own PR. In the same PR, update the reference JSONs and tests (`tests/test_reference_case.py`), `docs/data-model.md` if projected to FHIR, and regenerate the spec and web client (APIM-7).
- Handover change → bump `HANDOVER_SCHEMA_VERSION` (DM-9).
- No I/O, no business logic (DM-10).
