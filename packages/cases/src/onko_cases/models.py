"""Module-local types of `cases` (not shared contracts)."""

from __future__ import annotations

from dataclasses import dataclass


class TransitionError(ValueError):
    pass


@dataclass(frozen=True)
class TimeToTreatment:
    """Slide 4: T1 symptom -> referral to KOC, T2 referral -> MDT, T3 MDT -> treatment (days).
    A part is None until both of its dates are known."""

    t1: int | None
    t2: int | None
    t3: int | None

    @property
    def total(self) -> int | None:
        parts = (self.t1, self.t2, self.t3)
        return sum(parts) if all(p is not None for p in parts) else None
