"""Messaging module: requests for missing information, MDT result delivery, receipts.

Owner: stream C. The MVP channel is the in-app inbox; email/SMS are adapters behind `ChannelAdapter`.
The reviewing doctor (revizní lékař of the patient's insurer) gets every MDT result automatically (MessageKind.REVIEW_FEED).
Public API: only what `__all__` lists. Layout: docs/conventions/implementation.md.
"""

from __future__ import annotations

from .adapters.in_app import InAppInbox
from .ports import ChannelAdapter
from .service import confirm, send

__all__ = ["ChannelAdapter", "InAppInbox", "confirm", "send"]
