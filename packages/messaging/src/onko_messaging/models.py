"""Module-local types of `messaging` (not shared contracts)."""

from __future__ import annotations


class NotRecipientError(ValueError):
    """Only a recipient of the message can confirm its receipt."""


class NotConfirmableError(ValueError):
    """Receipt is confirmed only for an MDT result ('Potvrzuji převzetí')."""


class AlreadyConfirmedError(ValueError):
    """This recipient has confirmed the message already."""
