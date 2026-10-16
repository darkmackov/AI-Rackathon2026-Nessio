"""Request dependencies: the repository, the app clock, the AI jobs and the current user.

Both live on `app.state` (set up in main.py) so routes.py can reach them without importing main.
"""

from __future__ import annotations

from concurrent.futures import Executor
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from onko_contracts import Actor
from onko_llm_gateway import Gateway
from onko_repository import CaseRepository

from .clock import AppClock

ActorId = Annotated[str, Header(alias="X-Actor-Id", description="Current user (demo role switcher)")]

# The users of the app are the referring doctor and the coordinator (Q-F21).
USER_ROLES = frozenset({"referring_doctor", "coordinator"})


def get_repo(request: Request) -> CaseRepository:
    return request.app.state.repo


def get_clock(request: Request) -> AppClock:
    return request.app.state.clock


def get_gateway(request: Request) -> Gateway | None:
    return request.app.state.gateway


def get_jobs(request: Request) -> Executor:
    return request.app.state.jobs


Repo = Annotated[CaseRepository, Depends(get_repo)]
Clock = Annotated[AppClock, Depends(get_clock)]
Llm = Annotated[Gateway | None, Depends(get_gateway)]
Jobs = Annotated[Executor, Depends(get_jobs)]


def get_current_user(actor_id: ActorId, repo: Repo) -> Actor:
    """Resolve `X-Actor-Id` (role switcher, Q-I11): 404 if unknown, 403 if not a user."""
    try:
        actor = repo.get_actor(actor_id)
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "actor not found") from None
    if actor.role not in USER_ROLES:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "actor is not a user of the app")
    return actor


CurrentUser = Annotated[Actor, Depends(get_current_user)]
