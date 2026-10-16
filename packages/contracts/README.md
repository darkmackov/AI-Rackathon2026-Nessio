# contracts

Shared Pydantic models: `Case`, `CaseState`, `Handover` (`Sourced[T]` + `Evidence`), `Finding`, `Task`, `TaskSet`, `Message`, `Receipt`, `DocumentMeta`.

- **Owner:** everyone. A change here is its own PR and every stream reviews it.
- **Rule:** the handover structure follows `Handover_obsah` and is fixed product schema. Bump `HANDOVER_SCHEMA_VERSION` when it changes.
- **Tests:** the reference case must validate, and every quote in it must be verbatim (`tests/test_reference_case.py`).
