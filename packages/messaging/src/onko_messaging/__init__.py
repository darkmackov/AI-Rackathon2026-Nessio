"""Messaging module: MDT result delivery to the GP, receipts, in-app notifications, patient notices.

Owner: stream C. MVP scope:
- MDT result → the GP's in-app inbox → receipt ('Potvrzuji převzetí') closes the case.
- In-app deadline notifications (Q-F17).
- Patient notices are recorded with `simulated=True` and never delivered (Q-F16).
Not in the MVP: request/reply flows for additional documents (Q-F23; in the MVP a request is a
`Task` in onko_cases), the reviewing-doctor feed (Q-F10), email/SMS adapters.
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .adapters.in_app import InAppInbox
from .ports import ChannelAdapter
from .service import confirm, send

__all__ = ["ChannelAdapter", "InAppInbox", "confirm", "send"]
