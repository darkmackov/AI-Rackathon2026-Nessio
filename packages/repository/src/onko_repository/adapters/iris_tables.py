"""Relational tables generated from the contract models (Q-I14).

Every field becomes a typed column: scalars as SQL types, nested models flattened into
`<field>__<subfield>` columns (plus `<field>__present` when the nested model is optional), lists and
dicts as JSON text. Tables and missing columns are created on start, so a contract change that adds
a field needs no hand-written migration. Columns are quoted: field names like `state`, `date` or
`status` are SQL keywords.
"""

from __future__ import annotations

import json
import types
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Any, Generic, TypeVar, Union, get_args, get_origin

from pydantic import BaseModel

M = TypeVar("M", bound=BaseModel)

ID = "VARCHAR(200) COLLATE %EXACT"  # ids compare case-sensitively, like the in-memory fake
CODE = "VARCHAR(60) COLLATE %EXACT"  # enum values
TEXT = "VARCHAR(3641144)"  # IRIS's longest string; plain strings, so JSON_TABLE can read JSON
STREAM = "LONGVARCHAR"
BINARY = "LONGVARBINARY"


# IRIS stores TIMESTAMP as %PosixTime: microseconds since 1970 offset by 2**60. A query ordered by a
# timestamp column hands back that logical integer instead of the display value.
_POSIX_OFFSET = 1 << 60


def _timestamp(value: Any) -> Any:
    if isinstance(value, (int, str)) and str(value).isdigit() and int(value) >= _POSIX_OFFSET:
        return datetime(1970, 1, 1) + timedelta(microseconds=int(value) - _POSIX_OFFSET)
    return value


def quote(name: str) -> str:
    return f'"{name}"'


@dataclass(frozen=True)
class Column:
    name: str
    sql_type: str
    path: tuple[str, ...]
    kind: str  # "value" | "json" | "present"


def _unwrap(annotation: Any) -> tuple[Any, bool]:
    """`X | None` -> (X, True)."""
    if get_origin(annotation) in (Union, types.UnionType):
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0], True
    return annotation, False


def _is_model(annotation: Any) -> bool:
    return isinstance(annotation, type) and issubclass(annotation, BaseModel)


def _scalar_type(name: str, annotation: Any) -> str | None:
    if not isinstance(annotation, type):
        return None
    if issubclass(annotation, Enum):
        return CODE
    if issubclass(annotation, bool):
        return "BIT"
    if issubclass(annotation, int):
        return "BIGINT"
    if issubclass(annotation, float):
        return "DOUBLE"
    if issubclass(annotation, datetime):
        return "TIMESTAMP"
    if issubclass(annotation, date):
        return "DATE"
    if issubclass(annotation, str):
        return ID if name == "id" or name.endswith("_id") else TEXT
    return None


def model_columns(model: type[BaseModel], path: tuple[str, ...] = ()) -> list[Column]:
    columns: list[Column] = []
    for field_name, field in model.model_fields.items():
        annotation, optional = _unwrap(field.annotation)
        field_path = (*path, field_name)
        name = "__".join(field_path)
        if _is_model(annotation):
            if optional:
                columns.append(Column(f"{name}__present", "BIT", field_path, "present"))
            columns.extend(model_columns(annotation, field_path))
        elif (sql_type := _scalar_type(field_name, annotation)) is not None:
            columns.append(Column(name, sql_type, field_path, "value"))
        else:
            columns.append(Column(name, TEXT, field_path, "json"))
    return columns


def _get(data: Any, path: tuple[str, ...]) -> Any:
    for key in path:
        if data is None:
            return None
        data = data[key]
    return data


class ModelTable(Generic[M]):
    """One table holding one contract model, plus `extra` columns the port needs (e.g. the
    `case_id` of a finding, or a document's text and bytes)."""

    def __init__(
        self,
        name: str,
        model: type[M],
        *,
        key: tuple[str, ...],
        extra: dict[str, str] | None = None,
        indexes: tuple[str, ...] = (),
        foreign_keys: dict[str, str] | None = None,
    ) -> None:
        self.name = name
        self.model = model
        self.key = key
        self.extra = extra or {}
        self.indexes = indexes
        self.foreign_keys = foreign_keys or {}  # column -> referenced table (its "id")
        self.columns = model_columns(model)
        self.column_names = [c.name for c in self.columns]

    def column_types(self) -> dict[str, str]:
        types_ = {c.name: c.sql_type for c in self.columns}
        types_.update(self.extra)
        return types_

    def create_sql(self, qualified: str, qualify: Callable[[str], str] = lambda name: name) -> str:
        parts = [f"{quote(n)} {t}" for n, t in self.column_types().items()]
        parts.append(f"PRIMARY KEY ({', '.join(quote(k) for k in self.key)})")
        for column, table in self.foreign_keys.items():
            parts.append(f"FOREIGN KEY ({quote(column)}) REFERENCES {qualify(table)} ({quote('id')})")
        return f"CREATE TABLE {qualified} ({', '.join(parts)})"

    def select_list(self) -> str:
        return ", ".join(quote(n) for n in self.column_names)

    def row(self, model: M, **extra: Any) -> dict[str, Any]:
        data = model.model_dump()
        as_json = model.model_dump(mode="json")
        values: dict[str, Any] = {}
        for column in self.columns:
            if column.kind == "present":
                values[column.name] = 0 if _get(data, column.path) is None else 1
            elif column.kind == "json":
                value = _get(as_json, column.path)
                values[column.name] = None if value is None else json.dumps(value, ensure_ascii=False)
            else:
                value = _get(data, column.path)
                if isinstance(value, Enum):
                    value = value.value
                elif isinstance(value, bool):
                    value = 1 if value else 0
                values[column.name] = value
        values.update(extra)
        return values

    def model_from(self, row: Any) -> M:
        """Rebuild the model from a row in `select_list()` order. NULL leaves are left out, so a
        column added after the row was written falls back to the field's default."""
        data: dict[str, Any] = {}
        absent: list[tuple[str, ...]] = []
        for column, value in zip(self.columns, row, strict=True):
            if column.kind == "present":
                if value is not None and not value:
                    absent.append(column.path)
                continue
            if value is None:
                continue
            if column.kind == "json":
                value = json.loads(value)
            elif column.sql_type == "BIT":
                value = bool(value)
            elif column.sql_type == "TIMESTAMP":
                value = _timestamp(value)
            node = data
            for key in column.path[:-1]:
                node = node.setdefault(key, {})
            node[column.path[-1]] = value
        for path in absent:
            node = data
            for key in path[:-1]:
                node = node.setdefault(key, {})
            node[path[-1]] = None
        return self.model.model_validate(data)
