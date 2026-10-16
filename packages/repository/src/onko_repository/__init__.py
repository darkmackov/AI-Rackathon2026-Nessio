"""Repository module: the only code that talks to IRIS.

Owner: stream D. `CaseRepository` is the port; `InMemoryRepository` is the fake that every other
module tests against; `IrisRepository` maps contracts <-> FHIR R4 (EU/CZ profiles, see
docs/data-model.md) and, in Phase 2, IRIS SQL for vector chunks. IRIS runs in Azure; each dev supplies
their own connection string (`.env`, see `.env.example`).
"""

from __future__ import annotations

from typing import Protocol

from onko_contracts import Case, DocumentMeta, Finding, Handover, Message, Receipt, Task

from .settings import IrisConnection, IrisSettings, parse_connection_string


class CaseRepository(Protocol):
    def save_case(self, case: Case) -> None: ...
    def get_case(self, case_id: str) -> Case: ...
    def list_cases(self) -> list[Case]: ...

    def save_document(self, meta: DocumentMeta, data: bytes, text: str) -> None: ...
    def list_documents(self, case_id: str) -> list[DocumentMeta]: ...
    def document_text(self, document_id: str) -> str: ...

    def save_handover(self, handover: Handover, *, snapshot: bool = False) -> None: ...
    def get_handover(self, case_id: str, *, snapshot: bool = False) -> Handover | None: ...

    def save_findings(self, case_id: str, findings: list[Finding]) -> None: ...
    def list_findings(self, case_id: str) -> list[Finding]: ...

    def save_task(self, task: Task) -> None: ...
    def list_tasks(self, case_id: str) -> list[Task]: ...

    def save_message(self, message: Message) -> None: ...
    def list_messages(self, case_id: str) -> list[Message]: ...
    def save_receipt(self, receipt: Receipt) -> None: ...


class InMemoryRepository:
    """Dict-backed fake. Good enough for tests and for running the API without IRIS."""

    def __init__(self) -> None:
        self.cases: dict[str, Case] = {}
        self.documents: dict[str, tuple[DocumentMeta, bytes, str]] = {}
        self.handovers: dict[tuple[str, bool], Handover] = {}
        self.findings: dict[str, list[Finding]] = {}
        self.tasks: dict[str, Task] = {}
        self.messages: dict[str, Message] = {}
        self.receipts: list[Receipt] = []

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


class IrisRepository:
    """FHIR R4 over REST + IRIS SQL via the intersystems-irispython driver, against the shared
    Azure instance configured in `.env`. TODO stream D."""

    def __init__(self, settings: IrisSettings | None = None) -> None:
        self.settings = settings or IrisSettings()
        if self.settings.iris_connection_string is None:
            raise RuntimeError("Set ONKO_IRIS_CONNECTION_STRING in .env")
        self.connection = parse_connection_string(
            self.settings.iris_connection_string.get_secret_value()
        )


__all__ = [
    "CaseRepository",
    "InMemoryRepository",
    "IrisConnection",
    "IrisRepository",
    "IrisSettings",
    "parse_connection_string",
]
