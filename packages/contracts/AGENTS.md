# AI rules: contracts (`onko_contracts`)

Root rules: [AGENTS.md](../../AGENTS.md). Conventions: [docs/conventions/](../../docs/conventions).

**Owns:** Shared domain models (`onko_contracts`) and the API DTOs (`onko_contracts.dto`).

**May depend on:** pydantic only.

**Rules:**
- Domain models: follow DM-1 … DM-13 in data.md. Subclass `Model`, plain names, stable enum values.
- DTOs: follow DTO-1 … DTO-12. `XxxDto`, mirror the domain model, no defaults on response DTOs, reuse domain enums. `dto/` imports only enums and constants from the domain.
- Never put mapping code here: it lives in `apps/api/src/onko_api/mappers.py` (DTO-9).
- Any change here is its own PR. In the same PR, update the reference JSONs and tests (`tests/test_reference_case.py`), the DTO and mapper if exposed, `docs/data-model.md` if persisted, and regenerate the web client if the API changed.
- Handover change → bump `HANDOVER_SCHEMA_VERSION` (DM-9).
- No I/O, no business logic (DM-10).
