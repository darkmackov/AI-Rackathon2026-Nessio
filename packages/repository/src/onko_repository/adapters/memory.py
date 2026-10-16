"""Dict-backed fake repository."""

from __future__ import annotations

from onko_contracts import (
    Actor,
    AuditEvent,
    Case,
    DocumentMeta,
    Finding,
    Handover,
    Job,
    MdtBoard,
    MdtConclusion,
    Message,
    Organization,
    Receipt,
    Task,
)


class InMemoryRepository:
    """Dict-backed fake. Good enough for tests and for running the API without IRIS."""

    def __init__(self) -> None:
        self.clear()

    def clear(self) -> None:
        self.organizations: dict[str, Organization] = {}
        self.actors: dict[str, Actor] = {}
        self.mdt_boards: dict[str, MdtBoard] = {}
        self.cases: dict[str, Case] = {}
        self.documents: dict[str, tuple[DocumentMeta, bytes, str]] = {}
        self.handovers: dict[tuple[str, bool], Handover] = {}
        self.findings: dict[str, list[Finding]] = {}
        self.tasks: dict[str, Task] = {}
        self.messages: dict[str, Message] = {}
        self.receipts: list[Receipt] = []
        self.jobs: dict[str, Job] = {}
        self.audit: dict[str, AuditEvent] = {}
        self.mdt_conclusions: dict[str, MdtConclusion] = {}

    def save_organization(self, organization: Organization) -> None:
        self.organizations[organization.id] = organization

    def list_organizations(self) -> list[Organization]:
        return list(self.organizations.values())

    def save_actor(self, actor: Actor) -> None:
        self.actors[actor.id] = actor

    def get_actor(self, actor_id: str) -> Actor:
        return self.actors[actor_id]

    def list_actors(self) -> list[Actor]:
        return list(self.actors.values())

    def save_mdt_board(self, board: MdtBoard) -> None:
        self.mdt_boards[board.id] = board

    def get_mdt_board(self, board_id: str) -> MdtBoard:
        return self.mdt_boards[board_id]

    def list_mdt_boards(self) -> list[MdtBoard]:
        return list(self.mdt_boards.values())

    def save_case(self, case: Case) -> None:
        self.cases[case.id] = case

    def get_case(self, case_id: str) -> Case:
        return self.cases[case_id]

    def list_cases(self) -> list[Case]:
        return list(self.cases.values())

    def save_document(self, meta: DocumentMeta, data: bytes, text: str) -> None:
        self.documents[meta.id] = (meta, data, text)

    def list_documents(self, case_id: str) -> list[DocumentMeta]:
        return [m for m, _, _ in self.documents.values() if m.case_id == case_id]

    def document_text(self, document_id: str) -> str:
        return self.documents[document_id][2]

    def get_document(self, document_id: str) -> DocumentMeta | None:
        stored = self.documents.get(document_id)
        return None if stored is None else stored[0]

    def document_data(self, document_id: str) -> bytes | None:
        stored = self.documents.get(document_id)
        return None if stored is None else stored[1]

    def update_document(self, meta: DocumentMeta) -> None:
        _, data, text = self.documents[meta.id]
        self.documents[meta.id] = (meta, data, text)

    def save_handover(self, handover: Handover, *, snapshot: bool = False) -> None:
        self.handovers[(handover.case_id, snapshot)] = handover

    def get_handover(self, case_id: str, *, snapshot: bool = False) -> Handover | None:
        return self.handovers.get((case_id, snapshot))

    def save_findings(self, case_id: str, findings: list[Finding]) -> None:
        self.findings[case_id] = findings

    def list_findings(self, case_id: str) -> list[Finding]:
        return self.findings.get(case_id, [])

    def save_task(self, task: Task) -> None:
        self.tasks[task.id] = task

    def list_tasks(self, case_id: str) -> list[Task]:
        return [t for t in self.tasks.values() if t.case_id == case_id]

    def save_message(self, message: Message) -> None:
        self.messages[message.id] = message

    def list_messages(self, case_id: str) -> list[Message]:
        return [m for m in self.messages.values() if m.case_id == case_id]

    def save_receipt(self, receipt: Receipt) -> None:
        self.receipts.append(receipt)

    def save_job(self, job: Job) -> None:
        self.jobs[job.id] = job

    def get_job(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def list_jobs(self, case_id: str) -> list[Job]:
        return sorted((j for j in self.jobs.values() if j.case_id == case_id),
                      key=lambda j: j.created_at)

    def _require_case(self, case_id: str) -> None:
        """The foreign key `case_id` -> case, as in IRIS (PER-13)."""
        if case_id not in self.cases:
            raise KeyError(case_id)

    def save_audit(self, event: AuditEvent) -> None:
        self._require_case(event.case_id)
        if event.id in self.audit:
            raise ValueError(f"audit event {event.id} exists; audit rows are append-only")
        self.audit[event.id] = event

    def list_audit(self, case_id: str) -> list[AuditEvent]:
        return sorted((e for e in self.audit.values() if e.case_id == case_id), key=lambda e: e.at)

    def save_mdt_conclusion(self, conclusion: MdtConclusion) -> None:
        self._require_case(conclusion.case_id)
        self.mdt_conclusions[conclusion.case_id] = conclusion

    def get_mdt_conclusion(self, case_id: str) -> MdtConclusion | None:
        return self.mdt_conclusions.get(case_id)

    def pending_fhir_writes(self) -> int:
        return 0  # no FHIR projection
