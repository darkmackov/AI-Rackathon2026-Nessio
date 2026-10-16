"""Read-only MCP server for agents (S10, Q-I23), mounted in the FastAPI app under `/mcp`.

Streamable HTTP, stateless with JSON responses, so any worker can answer any call. Every tool needs
the same `X-Actor-Id` header as the REST API and returns the same contract models as the read
endpoints. There are no write tools: AI proposes, a human confirms. `ask_case` (S8, Q-I24) runs
synchronously, since a tool can't poll a job; its only write is the chunk indexing it needs.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from fastapi import HTTPException
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_headers
from onko_cases import open_tasks, time_to_treatment
from onko_contracts import (
    Actor,
    Case,
    CaseAnswer,
    CaseOverview,
    CaseState,
    Finding,
    Handover,
    QueueColumn,
    TimeToTreatment,
)
from onko_llm_gateway import Gateway
from onko_repository import CaseRepository

from .clock import AppClock
from .deps import get_current_user
from .jobs import answer
from .queries import search_cases as query_cases

INSTRUCTIONS = (
    "Read-only access to the cases of the oncology care coordination centres (KOC). Data is in "
    "Czech. Handover values carry their status and origin: origin=ai values quote the source "
    "document verbatim in `evidence`, origin=manual values were typed in by a person. Findings "
    "list what is missing or conflicting. Times are the app clock, which the demo may move."
)


def build_mcp(
    repo: Callable[[], CaseRepository],
    clock: Callable[[], AppClock],
    gateway: Callable[[], Gateway | None],
) -> FastMCP:
    """The MCP server over the repository, clock and gateway the app holds (all set up in its
    lifespan)."""
    mcp = FastMCP("onko-koordinace", instructions=INSTRUCTIONS)

    def user() -> Actor:
        """The same `X-Actor-Id` check as the REST API (Q-I11), as a tool error."""
        actor_id = get_http_headers().get("x-actor-id")
        if not actor_id:
            raise ToolError("X-Actor-Id header is required")
        try:
            return get_current_user(actor_id, repo())
        except HTTPException as e:
            raise ToolError(e.detail) from None

    def case_or_error(case_id: str) -> Case:
        try:
            return repo().get_case(case_id)
        except KeyError:
            raise ToolError("case not found") from None

    @mcp.tool(annotations={"readOnlyHint": True})
    def search_cases(
        koc_id: str | None = None,
        state: CaseState | None = None,
        queue: QueueColumn | None = None,
        overdue: bool = False,
        referring_doctor_id: str | None = None,
    ) -> list[Case]:
        """Search cases by KOC (organization id), state, dashboard queue, or referring doctor.
        With overdue=true, only cases whose next step (`next_due`) is already past due."""
        user()
        return query_cases(
            repo(),
            referring_doctor_id=referring_doctor_id,
            koc_id=koc_id,
            state=state,
            queue=queue,
            overdue_at=clock().now() if overdue else None,
        )

    @mcp.tool(annotations={"readOnlyHint": True})
    def get_case(case_id: str) -> Case:
        """Case summary: state, who is on the move (`on_move`), next step, its due date
        (`next_due`), the MDT date and the milestones behind time to treatment."""
        user()
        return case_or_error(case_id)

    @mcp.tool(annotations={"readOnlyHint": True})
    def get_time_to_treatment(case_id: str) -> TimeToTreatment:
        """Time to treatment in days: T1 symptom → referral, T2 referral → MDT, T3 MDT →
        treatment. A part is null until both of its dates are known."""
        user()
        return time_to_treatment(case_or_error(case_id))

    @mcp.tool(annotations={"readOnlyHint": True})
    def case_overview(case_id: str) -> CaseOverview:
        """One case at a glance: the case summary, time to treatment, unresolved findings (what
        is missing or conflicting) and open tasks, earliest due first. Use get_handover for the
        values and their source quotes."""
        user()
        case = case_or_error(case_id)
        tasks = open_tasks(repo().list_tasks(case_id))
        return CaseOverview(
            case=case,
            time_to_treatment=time_to_treatment(case),
            findings=[f for f in repo().list_findings(case_id) if not f.resolved],
            open_tasks=sorted(tasks, key=lambda t: t.due or datetime.max),
        )

    @mcp.tool(annotations={"readOnlyHint": True})
    def list_findings(case_id: str) -> list[Finding]:
        """What is missing or conflicting in the case's handover, with the affected fields."""
        user()
        case_or_error(case_id)
        return repo().list_findings(case_id)

    @mcp.tool(annotations={"readOnlyHint": True})
    def get_handover(case_id: str, snapshot: bool = False) -> Handover:
        """The structured handover. Every value has its status, origin and source quotes
        (`evidence`). With snapshot=true, the frozen MDT snapshot instead of the live handover."""
        user()
        case_or_error(case_id)
        handover = repo().get_handover(case_id, snapshot=snapshot)
        if handover is None:
            raise ToolError("no handover yet")
        return handover

    @mcp.tool(annotations={"readOnlyHint": True})
    def ask_case(case_id: str, question: str) -> CaseAnswer:
        """Ask a question about the case's documents (in Czech works best). The answer is only
        verbatim quotes from the documents (`quotes`, each with its document and position), or
        found=false ('nenalezeno') when no quote supports one. Never an inferred answer."""
        user()
        case_or_error(case_id)
        if not question.strip():
            raise ToolError("question is required")
        try:
            return answer(repo(), case_id, question, clock().now(), gateway())
        except RuntimeError as e:
            raise ToolError(str(e)) from None

    return mcp
