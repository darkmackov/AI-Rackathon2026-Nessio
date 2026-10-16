"""The app clock (D-10): the API's single notion of "now".

The reference case runs 2.–27. 10. 2026 while a demo runs in minutes. Setting the clock stores an
offset from the wall clock, so time keeps ticking from the set moment and successive actions get
distinct, ordered timestamps. This is the only place that reads the system clock (PY-4).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

from .schemas import DemoClock


class AppClock:
    def __init__(self, wall: Callable[[], datetime] = datetime.now) -> None:
        self._wall = wall
        self._offset: timedelta | None = None

    @property
    def simulated(self) -> bool:
        return self._offset is not None

    def now(self) -> datetime:
        wall = self._wall()
        return wall if self._offset is None else wall + self._offset

    def set(self, now: datetime | None) -> None:
        """Move the clock to `now`, or back to the wall clock with None. App datetimes are naive
        local time, so an aware `now` (e.g. a browser's `...Z`) is converted to it first."""
        if now is not None and now.tzinfo is not None:
            now = now.astimezone().replace(tzinfo=None)
        self._offset = None if now is None else now - self._wall()

    def as_model(self) -> DemoClock:
        return DemoClock(now=self.now(), simulated=self.simulated)
