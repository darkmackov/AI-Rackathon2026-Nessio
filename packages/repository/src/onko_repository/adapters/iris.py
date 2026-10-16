"""IRIS repository: app state as JSON documents in IRIS SQL, projected to FHIR R4 (EU/CZ profiles)
where needed (Q-A7); vector chunks in Phase 2."""

from __future__ import annotations

from ..settings import IrisSettings, parse_connection_string


class IrisRepository:
    """FHIR R4 over REST + IRIS SQL via the intersystems-irispython driver, against the shared
    Azure instance configured in `.env`. TODO stream D."""

    def __init__(self, settings: IrisSettings | None = None) -> None:
        self.settings = settings or IrisSettings()
        if self.settings.iris_connection_string is None:
            raise RuntimeError("Set ONKO_IRIS_CONNECTION_STRING in .env")
        self.connection = parse_connection_string(
            self.settings.iris_connection_string.get_secret_value()
        )
