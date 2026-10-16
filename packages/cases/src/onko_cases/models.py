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


class CodeNotNeededError(ValueError):
    """MKN-10 candidates are asked for a handover without a diagnosis, or whose code is set
    (Q-C11)."""
