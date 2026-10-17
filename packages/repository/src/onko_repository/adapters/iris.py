"""IRIS repository: app state in IRIS SQL tables, projected to FHIR R4 (EU/CZ profiles) where
needed (Q-A7, PER-4) through the FHIR outbox (D-14); document chunks and the MKN-10 code list with
their embeddings in `VECTOR` columns (S8, Q-I19).

Workflow state is relational: one table per model with a typed column per field, generated from the
contract models (`iris_tables`, Q-I14). Only the handover, a deep aggregate of `Sourced` values,
stays one JSON document per row; its clinical content is what the FHIR projection carries. The
tables are listed in docs/data-model.md › Non-FHIR storage (PER-11).

Each save that is projected queues its FHIR transaction in `fhir_outbox` in the same SQL
transaction, and sends it right after the commit; what fails is retried by `Outbox` (S9, D-14).
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, TypeVar

import iris.dbapi
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
from pydantic import BaseModel

from ..models import FhirExportUnavailableError
from ..settings import IrisSettings, parse_connection_string
from .fhir import (
    FhirProjector,
    Resource,
    audit_resource,
    document_resources,
    handover_resources,
    mdt_conclusion_resources,
    patient_id,
    task_resource,
    transaction,
)
from .iris_tables import BINARY, ID, STREAM, TEXT, ModelTable, quote
from .outbox import DEFAULT_RETRY_SECONDS, Outbox, OutboxEntry

log = logging.getLogger(__name__)

M = TypeVar("M", bound=BaseModel)

# Foreign key case_id -> app_case (Q-I26, PER-13). Not on app_job, app_receipt or fhir_outbox.
_CASE_FK = {"case_id": "app_case"}

ORGANIZATIONS = ModelTable("app_organization", Organization, key=("id",), bitmap_indexes=("kind",))
ACTORS = ModelTable("app_actor", Actor, key=("id",), indexes=("organization_id",),
                    bitmap_indexes=("role",))
MDT_BOARDS = ModelTable("app_mdt_board", MdtBoard, key=("id",))
CASES = ModelTable("app_case", Case, key=("id",), indexes=("koc_id", "referring_doctor_id"),
                   bitmap_indexes=("state", "queue"))
DOCUMENTS = ModelTable("app_document", DocumentMeta, key=("id",),
                       extra={"doc_text": STREAM, "doc_data": BINARY}, indexes=("case_id",),
                       foreign_keys=_CASE_FK)
FINDINGS = ModelTable("app_finding", Finding, key=("case_id", "id"),
                      extra={"case_id": ID, "seq": "INTEGER NOT NULL"}, foreign_keys=_CASE_FK)
TASKS = ModelTable("app_task", Task, key=("id",), indexes=("case_id", "owner", "due"),
                   foreign_keys=_CASE_FK)
# User-defined task sets (Q-F2); steps stay JSON, always read with their set (Q-I26). Not projected.
TASK_SETS = ModelTable("app_task_set", TaskSet, key=("id",))
MESSAGES = ModelTable("app_message", Message, key=("id",), indexes=("case_id",),
                      foreign_keys=_CASE_FK)
RECEIPTS = ModelTable("app_receipt", Receipt, key=("message_id", "recipient_id"))
JOBS = ModelTable("app_job", Job, key=("id",), indexes=("case_id",))
AUDIT = ModelTable("app_audit", AuditEvent, key=("id",), indexes=("case_id",),
                   foreign_keys=_CASE_FK)  # append-only (PER-13)
MDT_CONCLUSIONS = ModelTable("app_mdt_conclusion", MdtConclusion, key=("case_id",),
                             foreign_keys=_CASE_FK)
# The MDT record (MDT_zapis), built from the frozen snapshot (S5); members and results stay JSON.
MDT_RECORDS = ModelTable("app_mdt_record", MdtRecord, key=("case_id",), foreign_keys=_CASE_FK)
# Parents before children: created in this order, cleared and dropped in reverse.
MODEL_TABLES: list[ModelTable[Any]] = [
    ORGANIZATIONS, ACTORS, MDT_BOARDS, CASES, DOCUMENTS, FINDINGS, TASKS, TASK_SETS, MESSAGES,
    RECEIPTS, JOBS, AUDIT, MDT_CONCLUSIONS, MDT_RECORDS,
]


def vector_tables(dim: int) -> tuple[ModelTable[DocChunk], ModelTable[CodeCandidate]]:
    """`doc_chunk` and `mkn10_code` with an `embedding VECTOR(DOUBLE, dim)` column (S8, Q-I19).
    Only with ONKO_EMBED_DIM set, since the dimension is part of the column type."""
    embedding = {"embedding": f"VECTOR(DOUBLE, {dim})"}
    chunks = ModelTable("doc_chunk", DocChunk, key=("id",), extra=embedding,
                        indexes=("case_id", "document_id"),
                        foreign_keys={"case_id": CASES.name, "document_id": DOCUMENTS.name})
    codes = ModelTable("mkn10_code", CodeCandidate, key=("code",), extra=embedding)
    return chunks, codes


def _vector(values: list[float]) -> str:
    """A vector as `TO_VECTOR` reads it."""
    return ",".join(repr(float(v)) for v in values)

# The handover as one JSON document per (case, live | MDT snapshot). A plain string, not a stream,
# so IRIS SQL can query inside it with JSON_TABLE.
HANDOVER_TABLE = "app_handover"
HANDOVER_COLUMNS = {"case_id": ID, "is_snapshot": "BIT", "body": TEXT}
HANDOVER_FK = "fk_app_handover_case_id"  # case_id -> app_case

# Who each message is addressed to, so the inbox is an indexed lookup instead of a JSON scan
# (Q-I26). Written in the same save as `app_message`; keyed like `app_receipt`, no foreign key.
RECIPIENT_TABLE = "app_message_recipient"
RECIPIENT_COLUMNS = {"message_id": ID, "recipient_id": ID}
RECIPIENT_INDEX = f"idx_{RECIPIENT_TABLE}_recipient_id"

# What IRIS reports for a foreign-key violation on INSERT or UPDATE.
_FK_VIOLATION = "SQLCODE: <-121>"

# Pending FHIR writes (S9, D-14): the transaction Bundle as JSON, deleted once sent. Sent in %ID
# order. case_id has no foreign key: a document can be saved before its case. `rejected` = 1 parks
# a write the FHIR server refused for good (NULL while pending); it stays with its `last_error`.
OUTBOX_TABLE = "fhir_outbox"
OUTBOX_COLUMNS = {"id": ID, "case_id": ID, "bundle": STREAM, "attempts": "INTEGER NOT NULL",
                  "last_error": TEXT, "rejected": "INTEGER"}
_PENDING = '"rejected" IS NULL'


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
        retry_seconds: float | None = DEFAULT_RETRY_SECONDS,
    ) -> None:
        """`retry_seconds=None` sends only right after each save, with no retry thread."""
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
        self.embed_dim = self.settings.embed_dim
        self._vectors = vector_tables(self.embed_dim) if self.embed_dim else None
        self.create_tables()
        self.outbox: Outbox | None = None
        if projector is not None:
            self.outbox = Outbox(_OutboxTable(self), projector.send,
                                 retry_seconds=retry_seconds or DEFAULT_RETRY_SECONDS)
            if retry_seconds is not None:
                self.outbox.start()

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
        if self.outbox is not None:
            self.outbox.stop()
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    def _t(self, table: str) -> str:
        return f"{self.schema}.{table}"

    # --- schema ------------------------------------------------------------------------------

    def create_tables(self) -> None:
        """Create missing tables, add columns for fields new to the contracts, and add the indexes
        and foreign keys a table lacks (also on tables created before they were declared).
        Idempotent. Columns of removed fields stay and are ignored."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = ?",
                [self.schema],
            )
            existing: dict[str, set[str]] = {}
            for table, column in cur.fetchall():
                existing.setdefault(table.lower(), set()).add(column.lower())

            for table in self._model_tables():
                qualified = self._t(table.name)
                if table.name not in existing:
                    cur.execute(table.create_sql(qualified))
                    continue
                for name, sql_type in table.column_types().items():
                    if name.lower() not in existing[table.name]:
                        cur.execute(f"ALTER TABLE {qualified} ADD COLUMN {quote(name)} {sql_type}")

            if HANDOVER_TABLE not in existing:
                columns = ", ".join(f"{quote(n)} {t}" for n, t in HANDOVER_COLUMNS.items())
                cur.execute(f"CREATE TABLE {self._t(HANDOVER_TABLE)} ({columns}, "
                            f"PRIMARY KEY ({quote('case_id')}, {quote('is_snapshot')}))")

            if OUTBOX_TABLE not in existing:
                columns = ", ".join(f"{quote(n)} {t}" for n, t in OUTBOX_COLUMNS.items())
                cur.execute(f"CREATE TABLE {self._t(OUTBOX_TABLE)} ({columns}, "
                            f"PRIMARY KEY ({quote('id')}))")
            else:
                for name, sql_type in OUTBOX_COLUMNS.items():
                    if name not in existing[OUTBOX_TABLE]:
                        cur.execute(f"ALTER TABLE {self._t(OUTBOX_TABLE)} "
                                    f"ADD COLUMN {quote(name)} {sql_type}")

            if RECIPIENT_TABLE not in existing:
                columns = ", ".join(f"{quote(n)} {t}" for n, t in RECIPIENT_COLUMNS.items())
                cur.execute(f"CREATE TABLE {self._t(RECIPIENT_TABLE)} ({columns}, "
                            f"PRIMARY KEY ({quote('message_id')}, {quote('recipient_id')}))")

            cur.execute("SELECT TABLE_NAME, INDEX_NAME FROM INFORMATION_SCHEMA.INDEXES "
                        "WHERE TABLE_SCHEMA = ?", [self.schema])
            indexes = {(t.lower(), i.lower()) for t, i in cur.fetchall()}
            cur.execute(
                "SELECT c.TABLE_NAME, k.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS c "
                "JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA = c.TABLE_SCHEMA "
                "AND k.TABLE_NAME = c.TABLE_NAME AND k.CONSTRAINT_NAME = c.CONSTRAINT_NAME "
                "WHERE c.TABLE_SCHEMA = ? AND c.CONSTRAINT_TYPE = 'FOREIGN KEY'",
                [self.schema],
            )
            foreign_keys = {(t.lower(), c.lower()) for t, c in cur.fetchall()}

            for table in self._model_tables():
                qualified = self._t(table.name)
                name = table.name
                for sql in table.index_sql(qualified, lambda i, n=name: (n, i) not in indexes):
                    cur.execute(sql)
                for column in table.bitmap_indexes:  # was a normal index before Q-I27
                    if (table.name, f"idx_{table.name}_{column}") in indexes:
                        cur.execute(f"DROP INDEX idx_{table.name}_{column} ON TABLE {qualified}")
                for sql in table.foreign_key_sql(qualified, self._t,
                                                 lambda c, n=name: (n, c) not in foreign_keys):
                    cur.execute(sql)
            if (HANDOVER_TABLE, "case_id") not in foreign_keys:
                cur.execute(f"ALTER TABLE {self._t(HANDOVER_TABLE)} ADD CONSTRAINT {HANDOVER_FK} "
                            f"FOREIGN KEY ({quote('case_id')}) "
                            f"REFERENCES {self._t(CASES.name)} ({quote('id')})")
            if (RECIPIENT_TABLE, RECIPIENT_INDEX) not in indexes:
                cur.execute(f"CREATE INDEX {RECIPIENT_INDEX} ON {self._t(RECIPIENT_TABLE)} "
                            f"({quote('recipient_id')})")

    def drop_tables(self) -> None:
        """Drop every app-state table in this schema (tests and demo resets only)."""
        with self._cursor() as cur:
            cur.execute(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?",
                [self.schema],
            )
            existing = {row[0].lower() for row in cur.fetchall()}
            for name in [*self._table_names(), *self._reference_tables()]:
                if name in existing:
                    cur.execute(f"DROP TABLE {self._t(name)}")

    def _model_tables(self) -> list[ModelTable[Any]]:
        """Parents before children."""
        return [*MODEL_TABLES, *(self._vectors or ())]

    def _table_names(self) -> list[str]:
        """The app-state tables, children first, so foreign keys hold while rows or tables go."""
        chunks = [self._vectors[0].name] if self._vectors else []
        return [*chunks, OUTBOX_TABLE, HANDOVER_TABLE, RECIPIENT_TABLE,
                *reversed([t.name for t in MODEL_TABLES])]

    def _reference_tables(self) -> list[str]:
        """Reference data the demo reset keeps (the MKN-10 code list)."""
        return [self._vectors[1].name] if self._vectors else []

    def clear(self) -> None:
        """Delete every row of the app-state tables and the FHIR outbox (parked writes too),
        keeping the schema (demo reset). The FHIR projection is left as is: resources are upserted
        by id on the next save."""
        with self._cursor() as cur:
            for name in self._table_names():
                cur.execute(f"DELETE FROM {self._t(name)}")

    # --- helpers -----------------------------------------------------------------------------

    def _upsert_sql(self, table: str, values: dict[str, Any], *, verb: str = "INSERT OR UPDATE"
                    ) -> tuple[str, list[Any]]:
        columns = ", ".join(quote(c) for c in values)
        marks = ", ".join("?" for _ in values)
        return f"{verb} INTO {self._t(table)} ({columns}) VALUES ({marks})", list(values.values())

    @staticmethod
    @contextmanager
    def _case_reference(case_id: str | None) -> Iterator[None]:
        """A foreign-key violation on `case_id` as the in-memory fake's `KeyError` (PER-13)."""
        try:
            yield
        except iris.dbapi.IntegrityError as e:
            if case_id is not None and _FK_VIOLATION in str(e):
                raise KeyError(case_id) from None
            raise

    def _upsert(self, table: str, values: dict[str, Any]) -> None:
        self._write([self._upsert_sql(table, values)])

    def _write(self, statements: list[tuple[str, list[Any]]], *, case_id: str | None = None,
               fhir: list[Resource] | None = None) -> None:
        """Run the statements in one transaction, together with queuing their FHIR write (D-14);
        then send what is pending. A missing case is a `KeyError(case_id)`."""
        with self._case_reference(case_id), self._cursor() as cur:
            for sql, params in statements:
                cur.execute(sql, params)
            if fhir:
                cur.execute(*self._upsert_sql(OUTBOX_TABLE, {
                    "id": uuid.uuid4().hex, "case_id": case_id,
                    "bundle": json.dumps(transaction(fhir), ensure_ascii=False),
                    "attempts": 0, "last_error": None, "rejected": None,
                }, verb="INSERT"))
        if fhir and self.outbox is not None:
            self.outbox.flush()

    def _projection(self, build: Callable[[], list[Resource]]) -> list[Resource] | None:
        """The FHIR resources for a save, or None without a FHIR server. A mapping bug never loses
        the app-state save: it is logged and the save goes ahead unprojected."""
        if self.projector is None:
            return None
        try:
            return build()
        except Exception:
            log.exception("FHIR projection failed")
            return None

    def pending_fhir_writes(self) -> int:
        with self._cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {self._t(OUTBOX_TABLE)} WHERE {_PENDING}")
            return int(cur.fetchone()[0])

    def rejected_fhir_writes(self) -> int:
        with self._cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {self._t(OUTBOX_TABLE)} WHERE NOT ({_PENDING})")
            return int(cur.fetchone()[0])

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

    def _get_by_id(self, table: ModelTable[M], model_id: str) -> M:
        found = self._select(table, '"id" = ?', [model_id])
        if not found:
            raise KeyError(model_id)
        return found[0]

    # --- directory ---------------------------------------------------------------------------

    def save_organization(self, organization: Organization) -> None:
        self._upsert(ORGANIZATIONS.name, ORGANIZATIONS.row(organization))

    def list_organizations(self) -> list[Organization]:
        return self._select(ORGANIZATIONS)

    def save_actor(self, actor: Actor) -> None:
        self._upsert(ACTORS.name, ACTORS.row(actor))

    def get_actor(self, actor_id: str) -> Actor:
        return self._get_by_id(ACTORS, actor_id)

    def list_actors(self) -> list[Actor]:
        return self._select(ACTORS)

    def save_mdt_board(self, board: MdtBoard) -> None:
        self._upsert(MDT_BOARDS.name, MDT_BOARDS.row(board))

    def get_mdt_board(self, board_id: str) -> MdtBoard:
        return self._get_by_id(MDT_BOARDS, board_id)

    def list_mdt_boards(self) -> list[MdtBoard]:
        return self._select(MDT_BOARDS)

    # --- cases -------------------------------------------------------------------------------

    def save_case(self, case: Case) -> None:
        self._upsert(CASES.name, CASES.row(case))

    def get_case(self, case_id: str) -> Case:
        return self._get_by_id(CASES, case_id)

    def list_cases(self) -> list[Case]:
        return self._select(CASES)

    # --- documents ---------------------------------------------------------------------------

    def save_document(self, meta: DocumentMeta, data: bytes, text: str) -> None:
        self._write([self._upsert_sql(DOCUMENTS.name, DOCUMENTS.row(meta, doc_text=text,
                                                                     doc_data=data))],
                    case_id=meta.case_id,
                    fhir=self._projection(lambda: document_resources(meta, data, text)))

    def list_documents(self, case_id: str) -> list[DocumentMeta]:
        return self._select(DOCUMENTS, '"case_id" = ?', [case_id])

    def _document_column(self, column: str, document_id: str) -> Any:
        """The column's value, or `KeyError` if the document is unknown."""
        with self._cursor() as cur:
            cur.execute(f"SELECT {quote(column)} FROM {self._t(DOCUMENTS.name)} WHERE \"id\" = ?",
                        [document_id])
            row = cur.fetchone()
            if row is None:
                raise KeyError(document_id)
            return _bytes(row[0]) if column == "doc_data" else (_text(row[0]) or "")

    def document_text(self, document_id: str) -> str:
        return self._document_column("doc_text", document_id)

    def get_document(self, document_id: str) -> DocumentMeta | None:
        found = self._select(DOCUMENTS, '"id" = ?', [document_id])
        return found[0] if found else None

    def document_data(self, document_id: str) -> bytes | None:
        try:
            return self._document_column("doc_data", document_id)
        except KeyError:
            return None

    def update_document(self, meta: DocumentMeta) -> None:
        """Rewrites the metadata columns only; `doc_text` and `doc_data` stay."""
        values = DOCUMENTS.row(meta)
        assignments = ", ".join(f"{quote(c)} = ?" for c in values)
        with self._cursor() as cur:
            cur.execute(f'SELECT COUNT(*) FROM {self._t(DOCUMENTS.name)} WHERE "id" = ?', [meta.id])
            if not cur.fetchone()[0]:
                raise KeyError(meta.id)
        fhir = self._projection(lambda: document_resources(
            meta, self._document_column("doc_data", meta.id),
            self._document_column("doc_text", meta.id)))
        self._write([(f'UPDATE {self._t(DOCUMENTS.name)} SET {assignments} WHERE "id" = ?',
                      [*values.values(), meta.id])], case_id=meta.case_id, fhir=fhir)

    # --- handover ----------------------------------------------------------------------------

    def save_handover(self, handover: Handover, *, snapshot: bool = False) -> None:
        fhir = self._projection(lambda: handover_resources(
            handover, self._case_or_none(handover.case_id), snapshot=snapshot))
        self._write([self._upsert_sql(HANDOVER_TABLE, {
            "case_id": handover.case_id,
            "is_snapshot": 1 if snapshot else 0,
            "body": handover.model_dump_json(),
        })], case_id=handover.case_id, fhir=fhir)

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

    def _patient_projected(self, case_id: str) -> bool:
        """The case's FHIR `Patient` comes from the handover projection, queued before this write."""
        with self._cursor() as cur:
            cur.execute(f'SELECT COUNT(*) FROM {self._t(HANDOVER_TABLE)} WHERE "case_id" = ?',
                        [case_id])
            return bool(cur.fetchone()[0])

    def _directory_name(self, actor_or_org_id: str) -> str:
        """A person's or organisation's name for FHIR `display`; the id if it is not listed."""
        for table in (ACTORS, ORGANIZATIONS):
            found = self._select(table, '"id" = ?', [actor_or_org_id])
            if found:
                return found[0].name
        return actor_or_org_id

    def _require_case(self, case_id: str) -> None:
        """The foreign key `case_id` -> `app_case`, as a `KeyError` like the in-memory fake."""
        with self._cursor() as cur:
            cur.execute(f'SELECT COUNT(*) FROM {self._t(CASES.name)} WHERE "id" = ?', [case_id])
            if not cur.fetchone()[0]:
                raise KeyError(case_id)

    # --- findings ----------------------------------------------------------------------------

    def save_findings(self, case_id: str, findings: list[Finding]) -> None:
        """Replaces the case's findings, like the in-memory fake."""
        table = self._t(FINDINGS.name)
        if not findings:  # nothing references the case, but the fake still rejects it
            self._require_case(case_id)
        with self._case_reference(case_id), self._cursor() as cur:
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
        def build() -> list[Resource]:
            case = self._case_or_none(task.case_id)
            return [task_resource(
                task,
                requester=self._directory_name(case.koc_id) if case else task.case_id,
                owner=self._directory_name(task.owner),
                patient_on_server=self._patient_projected(task.case_id),
                patient_name=case.patient_name if case else None,
            )]

        self._write([self._upsert_sql(TASKS.name, TASKS.row(task))], case_id=task.case_id,
                    fhir=self._projection(build))

    def get_task(self, task_id: str) -> Task | None:
        found = self._select(TASKS, '"id" = ?', [task_id])
        return found[0] if found else None

    def list_tasks(self, case_id: str) -> list[Task]:
        return self._select(TASKS, '"case_id" = ?', [case_id])

    def save_task_set(self, task_set: TaskSet) -> None:
        self._upsert(TASK_SETS.name, TASK_SETS.row(task_set))

    def get_task_set(self, task_set_id: str) -> TaskSet | None:
        found = self._select(TASK_SETS, '"id" = ?', [task_set_id])
        return found[0] if found else None

    def list_task_sets(self) -> list[TaskSet]:
        return self._select(TASK_SETS)

    # --- messages ----------------------------------------------------------------------------

    def save_message(self, message: Message) -> None:
        """The message and its recipient rows in one transaction (Q-I26)."""
        recipients = self._t(RECIPIENT_TABLE)
        statements = [
            self._upsert_sql(MESSAGES.name, MESSAGES.row(message)),
            (f'DELETE FROM {recipients} WHERE "message_id" = ?', [message.id]),
        ]
        statements += [self._upsert_sql(RECIPIENT_TABLE, {"message_id": message.id,
                                                          "recipient_id": r}, verb="INSERT")
                       for r in dict.fromkeys(message.recipient_ids)]
        self._write(statements, case_id=message.case_id)

    def get_message(self, message_id: str) -> Message | None:
        found = self._select(MESSAGES, '"id" = ?', [message_id])
        return found[0] if found else None

    def list_messages(self, case_id: str) -> list[Message]:
        return self._select(MESSAGES, '"case_id" = ?', [case_id], order='"sent_at", %ID')

    def list_inbox(self, recipient_id: str) -> list[Message]:
        return self._select(
            MESSAGES,
            f'"id" IN (SELECT "message_id" FROM {self._t(RECIPIENT_TABLE)} '
            'WHERE "recipient_id" = ?)',
            [recipient_id], order='"sent_at" DESC, %ID DESC')

    def save_receipt(self, receipt: Receipt) -> None:
        self._upsert(RECEIPTS.name, RECEIPTS.row(receipt))

    def list_receipts(self, case_id: str) -> list[Receipt]:
        return self._select(
            RECEIPTS,
            f'"message_id" IN (SELECT "id" FROM {self._t(MESSAGES.name)} WHERE "case_id" = ?)',
            [case_id], order='"confirmed_at", %ID')

    # --- jobs --------------------------------------------------------------------------------

    def save_job(self, job: Job) -> None:
        self._upsert(JOBS.name, JOBS.row(job))

    def get_job(self, job_id: str) -> Job | None:
        found = self._select(JOBS, '"id" = ?', [job_id])
        return found[0] if found else None

    def list_jobs(self, case_id: str) -> list[Job]:
        return self._select(JOBS, '"case_id" = ?', [case_id], order='"created_at", %ID')

    # --- audit (append-only, PER-13) ----------------------------------------------------------

    def save_audit(self, event: AuditEvent) -> None:
        self._require_case(event.case_id)
        with self._cursor() as cur:
            cur.execute(f'SELECT COUNT(*) FROM {self._t(AUDIT.name)} WHERE "id" = ?', [event.id])
            if cur.fetchone()[0]:
                raise ValueError(f"audit event {event.id} exists; audit rows are append-only")
        fhir = self._projection(lambda: [audit_resource(
            event, patient_on_server=self._patient_projected(event.case_id))])
        self._write([self._upsert_sql(AUDIT.name, AUDIT.row(event), verb="INSERT")],
                    case_id=event.case_id, fhir=fhir)

    def list_audit(self, case_id: str) -> list[AuditEvent]:
        return self._select(AUDIT, '"case_id" = ?', [case_id], order='"at", %ID')

    # --- MDT record and conclusion ------------------------------------------------------------

    def save_mdt_record(self, record: MdtRecord) -> None:
        self._require_case(record.case_id)
        self._upsert(MDT_RECORDS.name, MDT_RECORDS.row(record))

    def get_mdt_record(self, case_id: str) -> MdtRecord | None:
        found = self._select(MDT_RECORDS, '"case_id" = ?', [case_id])
        return found[0] if found else None

    def save_mdt_conclusion(self, conclusion: MdtConclusion, *, pdf: bytes | None = None) -> None:
        """A confirmed conclusion is also sent as a FHIR document Bundle (S9, Q-I20), with the
        rendered `pdf` attached when it was written in the app."""
        self._require_case(conclusion.case_id)
        fhir = None
        if conclusion.confirmed is not None:
            case_id = conclusion.case_id
            fhir = self._projection(lambda: mdt_conclusion_resources(
                conclusion,
                self.get_handover(case_id, snapshot=True) or self.get_handover(case_id),
                self._case_or_none(case_id),
                patient_on_server=self._patient_projected(case_id),
                pdf=pdf,
            ))
        self._write([self._upsert_sql(MDT_CONCLUSIONS.name, MDT_CONCLUSIONS.row(conclusion))],
                    case_id=conclusion.case_id, fhir=fhir)

    def get_mdt_conclusion(self, case_id: str) -> MdtConclusion | None:
        found = self._select(MDT_CONCLUSIONS, '"case_id" = ?', [case_id])
        return found[0] if found else None

    def case_fhir_bundle(self, case_id: str) -> bytes | None:
        self.get_case(case_id)
        if self.projector is None:
            raise FhirExportUnavailableError("no FHIR exchange server")
        return self.projector.client.patient_bundle(patient_id(case_id))

    # --- vector search (S8, Q-I19) -------------------------------------------------------------

    def _vector_tables(self, vectors: list[list[float]] | None = None
                       ) -> tuple[ModelTable[DocChunk], ModelTable[CodeCandidate]]:
        if self._vectors is None:
            raise RuntimeError("Set ONKO_EMBED_DIM (the embedding model's dimension) in .env")
        if any(len(v) != self.embed_dim for v in vectors or []):
            raise ValueError(f"embeddings must have {self.embed_dim} dimensions (ONKO_EMBED_DIM)")
        return self._vectors

    def _insert_vector_sql(self, table: ModelTable[Any], values: dict[str, Any],
                           vector: list[float]) -> tuple[str, list[Any]]:
        columns = ", ".join(quote(c) for c in [*values, "embedding"])
        marks = ", ".join(["?"] * len(values) + [f"TO_VECTOR(?, DOUBLE, {self.embed_dim})"])
        return (f"INSERT INTO {self._t(table.name)} ({columns}) VALUES ({marks})",
                [*values.values(), _vector(vector)])

    def _nearest(self, table: ModelTable[M], vector: list[float], limit: int, where: str = "",
                 params: list[Any] | None = None) -> list[M]:
        """Exact scan ranked by cosine similarity, best first (Q-I19)."""
        self._vector_tables([vector])
        sql = f"SELECT TOP {int(limit)} {table.select_list()} FROM {self._t(table.name)}"
        if where:
            sql += f" WHERE {where}"
        sql += f' ORDER BY VECTOR_COSINE("embedding", TO_VECTOR(?, DOUBLE, {self.embed_dim})) DESC'
        with self._cursor() as cur:
            cur.execute(sql, [*(params or []), _vector(vector)])
            rows = [list(row) for row in cur.fetchall()]
        return [table.model_from(row) for row in rows]

    def save_chunks(self, document_id: str, chunks: list[DocChunk], vectors: list[list[float]]
                    ) -> None:
        table, _ = self._vector_tables(vectors)
        if len(chunks) != len(vectors):
            raise ValueError(f"{len(vectors)} vectors for {len(chunks)} chunks")
        if any(c.document_id != document_id for c in chunks):
            raise ValueError(f"every chunk must belong to document {document_id}")
        meta = self.get_document(document_id)
        if meta is None:
            raise KeyError(document_id)
        statements = [(f'DELETE FROM {self._t(table.name)} WHERE "document_id" = ?', [document_id])]
        statements += [self._insert_vector_sql(table, table.row(c), v)
                       for c, v in zip(chunks, vectors, strict=True)]
        self._write(statements, case_id=meta.case_id)

    def list_chunks(self, case_id: str) -> list[DocChunk]:
        table, _ = self._vector_tables()
        return self._select(table, '"case_id" = ?', [case_id], order='"document_id", "ord"')

    def nearest_chunks(self, case_id: str, vector: list[float], limit: int, *,
                       document_id: str | None = None) -> list[DocChunk]:
        table, _ = self._vector_tables()
        if document_id is None:
            return self._nearest(table, vector, limit, '"case_id" = ?', [case_id])
        return self._nearest(table, vector, limit, '"case_id" = ? AND "document_id" = ?',
                             [case_id, document_id])

    def save_codes(self, codes: list[CodeCandidate], vectors: list[list[float]]) -> None:
        _, table = self._vector_tables(vectors)
        if len(codes) != len(vectors):
            raise ValueError(f"{len(vectors)} vectors for {len(codes)} codes")
        self._write([(f"DELETE FROM {self._t(table.name)}", []),
                     *(self._insert_vector_sql(table, table.row(c), v)
                       for c, v in zip(codes, vectors, strict=True))])

    def count_codes(self) -> int:
        _, table = self._vector_tables()
        with self._cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {self._t(table.name)}")
            return int(cur.fetchone()[0])

    def nearest_codes(self, vector: list[float], limit: int) -> list[CodeCandidate]:
        _, table = self._vector_tables()
        return self._nearest(table, vector, limit)


class _OutboxTable:
    """`OutboxStore` on the `fhir_outbox` table."""

    def __init__(self, repo: IrisRepository) -> None:
        self.repo = repo
        self.table = repo._t(OUTBOX_TABLE)

    def oldest_pending(self) -> OutboxEntry | None:
        with self.repo._cursor() as cur:
            cur.execute(f'SELECT TOP 1 "id", "bundle", "attempts" FROM {self.table} '
                        f"WHERE {_PENDING} ORDER BY %ID")
            row = cur.fetchone()
            if row is None:
                return None
            return OutboxEntry(id=row[0], bundle=json.loads(_text(row[1]) or "{}"),
                               attempts=int(row[2]))

    def mark_sent(self, entry_id: str) -> None:
        with self.repo._cursor() as cur:
            cur.execute(f'DELETE FROM {self.table} WHERE "id" = ?', [entry_id])

    def mark_failed(self, entry_id: str, error: str) -> None:
        with self.repo._cursor() as cur:
            cur.execute(f'UPDATE {self.table} SET "attempts" = "attempts" + 1, "last_error" = ? '
                        'WHERE "id" = ?', [error, entry_id])

    def mark_rejected(self, entry_id: str, error: str) -> None:
        with self.repo._cursor() as cur:
            cur.execute(f'UPDATE {self.table} SET "attempts" = "attempts" + 1, "last_error" = ?, '
                        '"rejected" = 1 WHERE "id" = ?', [error, entry_id])

    def count_pending(self) -> int:
        return self.repo.pending_fhir_writes()
