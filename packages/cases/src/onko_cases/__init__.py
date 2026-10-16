"""Cases module: state machine, dashboard queue, tasks and task sets, and the GP's referral
(draft, manual handover edits, validation, sending; S3).

Owner: stream C. Task sets are user data (created in the UI), never config files.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .models import (
    CodeNotNeededError,
    HandoverEditError,
    HandoverLockedError,
    NotValidatedError,
    TransitionError,
)
from .referral import (
    EDITABLE_STATES,
    add_examination,
    diagnosis_for_code,
    new_referral,
    pick_diagnosis_code,
    receive_referral,
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
    "CodeNotNeededError",
    "HandoverEditError",
    "HandoverLockedError",
    "NotValidatedError",
    "TransitionError",
    "add_examination",
    "diagnosis_for_code",
    "new_referral",
    "next_step",
    "open_tasks",
    "pick_diagnosis_code",
    "put_on_hold",
    "queue_column",
    "ready_tasks",
    "receive_referral",
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
