"""Read queries shared by the REST routes and the MCP tools, so both answer the same way (Q-I23)."""

from __future__ import annotations

from datetime import datetime

from onko_contracts import Case, CaseState, QueueColumn
from onko_repository import CaseRepository


def search_cases(
    repo: CaseRepository,
    *,
    referring_doctor_id: str | None = None,
    koc_id: str | None = None,
    state: CaseState | None = None,
    queue: QueueColumn | None = None,
    overdue_at: datetime | None = None,
) -> list[Case]:
    """Filter the cases. Drafts (koncept) only appear when filtering by their referring doctor.
    With `overdue_at`, only cases whose next step was due before that moment."""
    cases = repo.list_cases()
    if referring_doctor_id is None:
        cases = [c for c in cases if c.state is not CaseState.DRAFT]
    return [
        c
        for c in cases
        if (referring_doctor_id is None or c.referring_doctor_id == referring_doctor_id)
        and (koc_id is None or c.koc_id == koc_id)
        and (state is None or c.state is state)
        and (queue is None or c.queue is queue)
        and (overdue_at is None or (c.next_due is not None and c.next_due < overdue_at))
    ]
