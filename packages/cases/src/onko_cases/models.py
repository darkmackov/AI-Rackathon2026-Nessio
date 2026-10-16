"""Module-local types of `cases` (not shared contracts)."""

from __future__ import annotations


class TransitionError(ValueError):
    pass


class HandoverEditError(ValueError):
    """A manual handover edit that names no editable field, or gives neither a value nor
    `not_available`."""


class HandoverLockedError(ValueError):
    """The handover can't be changed by this role in the case's current state."""


class NotValidatedError(ValueError):
    """The referral is sent without a (fresh) validation by the referring doctor."""


class CaseStateError(ValueError):
    """The action isn't allowed in the case's current state (e.g. a hold before take-over)."""


class TaskError(ValueError):
    """A task or task set that doesn't hold together: unknown dependency, a cycle, a duplicate
    step key, an owner role without an owner."""


class OverrideNotAllowedError(ValueError):
    """An override of a finding that isn't overridable (Q-C2)."""
