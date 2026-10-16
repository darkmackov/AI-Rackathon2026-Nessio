"""IRIS repository: app state in IRIS SQL tables, projected to FHIR R4 (EU/CZ profiles) where
needed (Q-A7, PER-4); vector chunks in Phase 2.

Workflow state is relational: one table per model with a typed column per field, generated from the
contract models (`iris_tables`, Q-I14). Only the handover, a deep aggregate of `Sourced` values,
stays one JSON document per row; its clinical content is what the FHIR projection carries. The
tables are listed in docs/data-model.md › Non-FHIR storage (PER-11).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, TypeVar

import iris.dbapi
from onko_contracts import Case, DocumentMeta, Finding, Handover, Message, Receipt, Task
from pydantic import BaseModel

from ..settings import IrisSettings, parse_connection_string
from .fhir import FhirProjector
from .iris_tables import BINARY, ID, STREAM, TEXT, ModelTable, quote

log = logging.getLogger(__name__)

M = TypeVar("M", bound=BaseModel)

CASES = ModelTable("app_case", Case, key=("id",),
                   indexes=("koc_id", "referring_doctor_id", "state", "queue"))
DOCUMENTS = ModelTable("app_document", DocumentMeta, key=("id",),
                       extra={"doc_text": STREAM, "doc_data": BINARY}, indexes=("case_id",))
FINDINGS = ModelTable("app_finding", Finding, key=("case_id", "id"),
                      extra={"case_id": ID, "seq": "INTEGER NOT NULL"})
TASKS = ModelTable("app_task", Task, key=("id",), indexes=("case_id", "owner", "due"))
MESSAGES = ModelTable("app_message", Message, key=("id",), indexes=("case_id",))
RECEIPTS = ModelTable("app_receipt", Receipt, key=("message_id", "recipient_id"))
MODEL_TABLES: list[ModelTable[Any]] = [CASES, DOCUMENTS, FINDINGS, TASKS, MESSAGES, RECEIPTS]

# The handover as one JSON document per (case, live | MDT snapshot). A plain string, not a stream,
# so IRIS SQL can query inside it with JSON_TABLE.
HANDOVER_TABLE = "app_handover"
HANDOVER_COLUMNS = {"case_id": ID, "is_snapshot": "BIT", "body": TEXT}


def _text(value: Any) -> str | None:
    """Stream columns come back as a stream object for large values."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return _text(value.read())


def _bytes(value: Any) -> bytes:
    if value is None:
        return b""
    if isinstance(value, bytes):
        return value
    if isinstance(value, str):
        return value.encode("latin-1")
    return _bytes(value.read())


class IrisRepository:
    """`CaseRepository` on the shared Azure IRIS configured in `.env`: SQL through the
    intersystems-irispython driver, the FHIR projection over REST when `ONKO_FHIR_BASE_URL` is set.

    One connection, used under a lock: FastAPI runs sync routes in a thread pool.
    """

    def __init__(
        self,
        settings: IrisSettings | None = None,
        *,
        schema: str | None = None,
        projector: FhirProjector | None = None,
        connect: Callable[[], Any] | None = None,
    ) -> None:
        self.settings = settings or IrisSettings()
        if self.settings.iris_connection_string is None:
            raise RuntimeError("Set ONKO_IRIS_CONNECTION_STRING in .env")
        self.connection = parse_connection_string(
            self.settings.iris_connection_string.get_secret_value()
        )
        self.schema = schema or self.settings.iris_schema or "onko"
        if projector is None and self.settings.fhir_configured:
            projector = FhirProjector.from_settings(self.settings)
        self.projector = projector
        self._connect = connect or self._connect_driver
        self._lock = threading.RLock()
        self._conn: Any = None
        self.create_tables()

    # --- connection --------------------------------------------------------------------------

    def _connect_driver(self) -> Any:
        c = self.connection
        return iris.dbapi.connect(
            hostname=c.host,
            port=c.port,
            namespace=c.namespace,
            username=c.username,
            password=c.password,
            sslconfig=self.settings.iris_ssl_config or None,
            autoCommit=False,
        )

    @contextmanager
    def _cursor(self) -> Iterator[Any]:
        """One transaction: commit on success, roll back on error. Reconnects a dropped link."""
        with self._lock:
            if self._conn is None or self._conn.isClosed():
                self._conn = self._connect()
            cursor = self._conn.cursor()
            try:
                yield cursor
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise
            finally:
                cursor.close()

    def close(self) -> None:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    def _t(self, table: str) -> str:
        return f"{self.schema}.{table}"

    # --- schema ------------------------------------------------------------------------------

    def create_tables(self) -> None:
        """Create missing tables and add columns for fields new to the contracts. Idempotent.
        Columns of removed fields stay and are ignored."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = ?",
                [self.schema],
            )
            existing: dict[str, set[str]] = {}
            for table, column in cur.fetchall():
                existing.setdefault(table.lower(), set()).add(column.lower())

            for table in MODEL_TABLES:
                qualified = self._t(table.name)
                if table.name not in existing:
                    cur.execute(table.create_sql(qualified))
                    for column in table.indexes:
                        cur.execute(f"CREATE INDEX idx_{table.name}_{column} "
                                    f"ON {qualified} ({quote(column)})")
                    continue
                for name, sql_type in table.column_types().items():
                    if name.lower() not in existing[table.name]:
                        cur.execute(f"ALTER TABLE {qualified} ADD COLUMN {quote(name)} {sql_type}")

            if HANDOVER_TABLE not in existing:
                columns = ", ".join(f"{quote(n)} {t}" for n, t in HANDOVER_COLUMNS.items())
                cur.execute(f"CREATE TABLE {self._t(HANDOVER_TABLE)} ({columns}, "
                            f"PRIMARY KEY ({quote('case_id')}, {quote('is_snapshot')}))")

    def drop_tables(self) -> None:
        """Drop every app-state table in this schema (tests and demo resets only)."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
                [self.schema],
            )
            existing = {row[0].lower() for row in cur.fetchall()}
            for name in [t.name for t in MODEL_TABLES] + [HANDOVER_TABLE]:
                if name in existing:
                    cur.execute(f"DROP TABLE {self._t(name)}")

    # --- helpers -----------------------------------------------------------------------------

    def _upsert(self, table: str, values: dict[str, Any]) -> None:
        columns = ", ".join(quote(c) for c in values)
        marks = ", ".join("?" for _ in values)
        with self._cursor() as cur:
            cur.execute(
                f"INSERT OR UPDATE INTO {self._t(table)} ({columns}) VALUES ({marks})",
                list(values.values()),
            )

    def _select(self, table: ModelTable[M], where: str = "", params: list[Any] | None = None,
                order: str = "%ID") -> list[M]:
        sql = f"SELECT {table.select_list()} FROM {self._t(table.name)}"
        if where:
            sql += f" WHERE {where}"
        with self._cursor() as cur:
            cur.execute(f"{sql} ORDER BY {order}", params or [])
            # Read every value while the cursor is open (large values are fetched lazily).
            rows = [list(row) for row in cur.fetchall()]
        return [table.model_from(row) for row in rows]

    def _project(self, action: Callable[[FhirProjector], None]) -> None:
        """The FHIR projection follows the app state; a failed projection never loses the save."""
        if self.projector is None:
            return
        try:
            action(self.projector)
        except Exception:
            log.exception("FHIR projection failed")

    # --- cases -------------------------------------------------------------------------------

    def save_case(self, case: Case) -> None:
        self._upsert(CASES.name, CASES.row(case))

    def get_case(self, case_id: str) -> Case:
        found = self._select(CASES, '"id" = ?', [case_id])
        if not found:
            raise KeyError(case_id)
        return found[0]

    def list_cases(self) -> list[Case]:
        return self._select(CASES)

    # --- documents ---------------------------------------------------------------------------

    def save_document(self, meta: DocumentMeta, data: bytes, text: str) -> None:
        self._upsert(DOCUMENTS.name, DOCUMENTS.row(meta, doc_text=text, doc_data=data))
        self._project(lambda p: p.project_document(meta, data, text))

    def list_documents(self, case_id: str) -> list[DocumentMeta]:
        return self._select(DOCUMENTS, '"case_id" = ?', [case_id])

    def _document_column(self, column: str, document_id: str) -> Any:
        with self._cursor() as cur:
            cur.execute(f"SELECT {quote(column)} FROM {self._t(DOCUMENTS.name)} WHERE \"id\" = ?",
                        [document_id])
            row = cur.fetchone()
            if row is None:
                raise KeyError(document_id)
            return _bytes(row[0]) if column == "doc_data" else (_text(row[0]) or "")

    def document_text(self, document_id: str) -> str:
        return self._document_column("doc_text", document_id)

    def document_data(self, document_id: str) -> bytes:
        """The original file. Not on the port yet: `getDocumentFile` (S2) adds it there."""
        return self._document_column("doc_data", document_id)

    # --- handover ----------------------------------------------------------------------------

    def save_handover(self, handover: Handover, *, snapshot: bool = False) -> None:
        self._upsert(HANDOVER_TABLE, {
            "case_id": handover.case_id,
            "is_snapshot": 1 if snapshot else 0,
            "body": handover.model_dump_json(),
        })
        self._project(lambda p: p.project_handover(handover, self._case_or_none(handover.case_id),
                                                   snapshot=snapshot))

    def get_handover(self, case_id: str, *, snapshot: bool = False) -> Handover | None:
        with self._cursor() as cur:
            cur.execute(
                f'SELECT "body" FROM {self._t(HANDOVER_TABLE)} '
                'WHERE "case_id" = ? AND "is_snapshot" = ?',
                [case_id, 1 if snapshot else 0],
            )
            row = cur.fetchone()
            body = None if row is None else _text(row[0])
        return None if body is None else Handover.model_validate_json(body)

    def _case_or_none(self, case_id: str) -> Case | None:
        try:
            return self.get_case(case_id)
        except KeyError:
            return None

    # --- findings ----------------------------------------------------------------------------

    def save_findings(self, case_id: str, findings: list[Finding]) -> None:
        """Replaces the case's findings, like the in-memory fake."""
        table = self._t(FINDINGS.name)
        with self._cursor() as cur:
            cur.execute(f'DELETE FROM {table} WHERE "case_id" = ?', [case_id])
            for seq, finding in enumerate(findings):
                values = FINDINGS.row(finding, case_id=case_id, seq=seq)
                columns = ", ".join(quote(c) for c in values)
                marks = ", ".join("?" for _ in values)
                cur.execute(f"INSERT INTO {table} ({columns}) VALUES ({marks})",
                            list(values.values()))

    def list_findings(self, case_id: str) -> list[Finding]:
        return self._select(FINDINGS, '"case_id" = ?', [case_id], order='"seq"')

    # --- tasks -------------------------------------------------------------------------------

    def save_task(self, task: Task) -> None:
        self._upsert(TASKS.name, TASKS.row(task))

    def list_tasks(self, case_id: str) -> list[Task]:
        return self._select(TASKS, '"case_id" = ?', [case_id])

    # --- messages ----------------------------------------------------------------------------

    def save_message(self, message: Message) -> None:
        self._upsert(MESSAGES.name, MESSAGES.row(message))

    def list_messages(self, case_id: str) -> list[Message]:
        return self._select(MESSAGES, '"case_id" = ?', [case_id])

    def save_receipt(self, receipt: Receipt) -> None:
        self._upsert(RECEIPTS.name, RECEIPTS.row(receipt))
