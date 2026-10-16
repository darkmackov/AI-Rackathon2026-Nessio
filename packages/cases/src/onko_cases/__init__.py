"""Cases module: state machine, dashboard queue, tasks and task sets.

Owner: stream C. Task sets are user data (created in the UI), never config files.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .models import TimeToTreatment, TransitionError
from .service import (
    next_step,
    open_tasks,
    put_on_hold,
    queue_column,
    ready_tasks,
    resume,
    start_task_set,
    time_to_treatment,
    transition,
)

__all__ = [
    "TimeToTreatment",
    "TransitionError",
    "next_step",
    "open_tasks",
    "put_on_hold",
    "queue_column",
    "ready_tasks",
    "resume",
    "start_task_set",
    "time_to_treatment",
    "transition",
]
