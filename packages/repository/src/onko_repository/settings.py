"""Connection settings for the shared IRIS instance in Azure. Each dev sets their own in `.env`."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class IrisSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ONKO_", env_file=".env", extra="ignore")

    # iris://USER:PASSWORD@HOST:PORT/NAMESPACE
    iris_connection_string: SecretStr | None = None
    # Optional TLS: passed to iris.connect(..., sslconfig=...) (Q-I4)
    iris_ssl_config: str | None = None
    # SQL schema holding the app-state tables (data-model.md › Non-FHIR storage); default "onko"
    iris_schema: str | None = None
    # FHIR REST endpoint on the same instance, e.g. https://host/fhir/r4 (basic auth, Q-I4/Q-I5)
    fhir_base_url: str | None = None
    fhir_username: str | None = None
    fhir_password: SecretStr | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        # .env.example ships `ONKO_X=` lines; an empty value means "not configured".
        return None if value == "" else value

    @property
    def iris_configured(self) -> bool:
        return self.iris_connection_string is not None

    @property
    def fhir_configured(self) -> bool:
        return self.fhir_base_url is not None


@dataclass(frozen=True)
class IrisConnection:
    host: str
    port: int
    namespace: str
    username: str
    password: str

    @property
    def dsn(self) -> str:
        """`host:port/NAMESPACE`, the form `iris.connect(dsn, user, password)` takes."""
        return f"{self.host}:{self.port}/{self.namespace}"


def parse_connection_string(value: str) -> IrisConnection:
    parts = urlsplit(value)
    if parts.scheme != "iris":
        raise ValueError("expected iris://USER:PASSWORD@HOST:PORT/NAMESPACE")
    namespace = parts.path.strip("/")
    if not (parts.hostname and parts.username and namespace):
        raise ValueError("connection string needs user, host and namespace")
    return IrisConnection(
        host=parts.hostname,
        port=parts.port or 1972,
        namespace=namespace,
        username=unquote(parts.username),
        password=unquote(parts.password or ""),
    )
