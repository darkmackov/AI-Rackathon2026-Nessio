"""Cases module: state machine, dashboard queue, tasks and task sets, and the GP's referral
(draft, manual handover edits, validation, sending; S3).

Owner: stream C. Task sets are user data (created in the UI), never config files.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .models import HandoverEditError, HandoverLockedError, NotValidatedError, TransitionError
from .referral import (
    EDITABLE_STATES,
    add_examination,
    new_referral,
    require_editable,
    send_referral,
    set_handover_field,
    sync_case_from_handover,
    validate_handover,
)
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
    "EDITABLE_STATES",
    "HandoverEditError",
    "HandoverLockedError",
    "NotValidatedError",
    "TransitionError",
    "add_examination",
    "new_referral",
    "next_step",
    "open_tasks",
    "put_on_hold",
    "queue_column",
    "ready_tasks",
    "require_editable",
    "resume",
    "send_referral",
    "set_handover_field",
    "start_task_set",
    "sync_case_from_handover",
    "time_to_treatment",
    "transition",
    "validate_handover",
]
