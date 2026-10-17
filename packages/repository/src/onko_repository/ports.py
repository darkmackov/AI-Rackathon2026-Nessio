"""The repository port. Every adapter (in-memory fake, IRIS) implements it."""

from __future__ import annotations

from typing import Protocol

from onko_contracts import (
    Actor,
    AuditEvent,
    Case,
    CodeCandidate,
    DocChunk,
    DocumentMeta,
    Finding,
    Handover,
    Job,
    MdtBoard,
    MdtConclusion,
    MdtRecord,
    Message,
    Organization,
    Receipt,
    Task,
    TaskSet,
)


class CaseRepository(Protocol):
    def clear(self) -> None:
        """Remove all stored data (demo reset)."""
        ...

    def save_organization(self, organization: Organization) -> None: ...
    def list_organizations(self) -> list[Organization]: ...

    def save_actor(self, actor: Actor) -> None: ...
    def get_actor(self, actor_id: str) -> Actor: ...
    def list_actors(self) -> list[Actor]: ...

    def save_mdt_board(self, board: MdtBoard) -> None: ...
    def get_mdt_board(self, board_id: str) -> MdtBoard: ...
    def list_mdt_boards(self) -> list[MdtBoard]: ...

    def save_case(self, case: Case) -> None: ...
    def get_case(self, case_id: str) -> Case: ...
    def list_cases(self) -> list[Case]: ...

    def save_document(self, meta: DocumentMeta, data: bytes, text: str) -> None:
        """`KeyError` if the case is unknown (foreign key, Q-I26)."""
        ...

    def list_documents(self, case_id: str) -> list[DocumentMeta]: ...
    def document_text(self, document_id: str) -> str: ...
    def get_document(self, document_id: str) -> DocumentMeta | None: ...
    def document_data(self, document_id: str) -> bytes | None: ...

    def update_document(self, meta: DocumentMeta) -> None:
        """Replace a stored document's metadata, keeping its bytes and text. `KeyError` if the
        document is unknown."""
        ...

    def save_job(self, job: Job) -> None: ...
    def get_job(self, job_id: str) -> Job | None: ...

    def list_jobs(self, case_id: str) -> list[Job]:
        """The case's jobs, oldest `created_at` first."""
        ...

    def save_handover(self, handover: Handover, *, snapshot: bool = False) -> None:
        """`KeyError` if the case is unknown."""
        ...

    def get_handover(self, case_id: str, *, snapshot: bool = False) -> Handover | None: ...

    def save_findings(self, case_id: str, findings: list[Finding]) -> None:
        """Replace the case's findings. `KeyError` if the case is unknown."""
        ...

    def list_findings(self, case_id: str) -> list[Finding]: ...

    def save_task(self, task: Task) -> None:
        """`KeyError` if the case is unknown."""
        ...

    def get_task(self, task_id: str) -> Task | None: ...
    def list_tasks(self, case_id: str) -> list[Task]: ...

    def save_task_set(self, task_set: TaskSet) -> None:
        """Store a task set (user data, Q-F2), replacing one with the same id."""
        ...

    def get_task_set(self, task_set_id: str) -> TaskSet | None: ...

    def list_task_sets(self) -> list[TaskSet]:
        """Every task set, in the order first saved."""
        ...

    def save_message(self, message: Message) -> None:
        """Store a message (replacing one with the same id) and index its recipients for
        `list_inbox`, in one save (Q-I26). `KeyError` if the case is unknown."""
        ...

    def get_message(self, message_id: str) -> Message | None: ...

    def list_messages(self, case_id: str) -> list[Message]:
        """The case's messages, oldest `sent_at` first (unsent ones before any sent)."""
        ...

    def list_inbox(self, recipient_id: str) -> list[Message]:
        """Every message addressed to `recipient_id`, across cases, newest `sent_at` first."""
        ...

    def save_receipt(self, receipt: Receipt) -> None: ...

    def list_receipts(self, case_id: str) -> list[Receipt]:
        """Receipts for the case's messages, oldest `confirmed_at` first."""
        ...

    def save_audit(self, event: AuditEvent) -> None:
        """Append one audit event (PER-13): `ValueError` if its id is taken, `KeyError` if the case
        is unknown. Audit rows are never updated."""
        ...

    def list_audit(self, case_id: str) -> list[AuditEvent]:
        """The case's audit trail, oldest `at` first."""
        ...

    def save_mdt_record(self, record: MdtRecord) -> None:
        """Store the case's MDT record (one per case, replaced on save). `KeyError` if the case is
        unknown."""
        ...

    def get_mdt_record(self, case_id: str) -> MdtRecord | None: ...

    def save_mdt_conclusion(self, conclusion: MdtConclusion, *, pdf: bytes | None = None) -> None:
        """Store the case's MDT conclusion (one per case, replaced on save). `KeyError` if the case
        is unknown. `pdf` is the rendered conclusion; a FHIR projection attaches it to a confirmed
        written conclusion (Q-I20). It is not stored as app state."""
        ...

    def get_mdt_conclusion(self, case_id: str) -> MdtConclusion | None: ...

    # --- vector search (S8, Q-I19) -------------------------------------------------------------

    def save_chunks(self, document_id: str, chunks: list[DocChunk], vectors: list[list[float]]
                    ) -> None:
        """Replace the document's chunks and their embeddings (one vector per chunk). `KeyError` if
        the document is unknown, `ValueError` if a chunk belongs to another document or the counts
        differ."""
        ...

    def list_chunks(self, case_id: str) -> list[DocChunk]:
        """The case's chunks, by document, then `ord`."""
        ...

    def nearest_chunks(self, case_id: str, vector: list[float], limit: int, *,
                       document_id: str | None = None) -> list[DocChunk]:
        """The case's (or one document's) `limit` chunks most similar to `vector` (cosine), best
        first. An exact scan, no approximate index (Q-I19)."""
        ...

    def save_codes(self, codes: list[CodeCandidate], vectors: list[list[float]]) -> None:
        """Replace the MKN-10 code list (Q-C11, Q-C12) with one embedding per code. Reference data:
        `clear()` keeps it."""
        ...

    def count_codes(self) -> int: ...

    def nearest_codes(self, vector: list[float], limit: int) -> list[CodeCandidate]:
        """The `limit` codes most similar to `vector` (cosine), best first."""
        ...

    def pending_fhir_writes(self) -> int:
        """FHIR writes waiting in the outbox (D-14); always 0 without a FHIR projection."""
        ...

    def case_fhir_bundle(self, case_id: str) -> bytes | None:
        """Download projected Patient/$everything as a JSON file; no app state changes.
        `KeyError` for an unknown case; None if the patient is not projected.
        FhirExportUnavailableError without FHIR, FhirExportError on an incomplete/failed response.
        """
        ...
