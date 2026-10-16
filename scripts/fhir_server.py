"""Create the FHIR R4 server on the IRIS for Health instance in .env (Q-I5). Idempotent.

Creates namespace FHIRSERVER (if missing) and the endpoint at the path of ONKO_FHIR_BASE_URL
(default /fhir/r4), over the Native API with the credentials of ONKO_IRIS_CONNECTION_STRING.
The installer calls follow the InterSystems FHIR-AI-Hackathon-Kit (fhir_server_setup_native.py).

Usage:
    uv run python scripts/fhir_server.py
"""

from __future__ import annotations

from urllib.parse import urlsplit

import iris
from onko_repository import IrisSettings, parse_connection_string

NAMESPACE = "FHIRSERVER"
STRATEGY = "HS.FHIRServer.Storage.JsonAdvSQL.InteractionsStrategy"
METADATA = "hl7.fhir.r4.core@4.0.1"


def main() -> None:
    settings = IrisSettings()
    if settings.iris_connection_string is None:
        raise SystemExit("Set ONKO_IRIS_CONNECTION_STRING in .env")
    conn = parse_connection_string(settings.iris_connection_string.get_secret_value())
    endpoint = urlsplit(settings.fhir_base_url).path.rstrip("/") if settings.fhir_base_url else "/fhir/r4"

    def native(namespace: str):
        connection = iris.createConnection(conn.host, conn.port, namespace, conn.username, conn.password)
        return connection, iris.createIRIS(connection)

    connection, irispy = native("HSLIB")
    try:
        if not irispy.classMethodBoolean("%SYS.Namespace", "Exists", NAMESPACE):
            print(f"Creating namespace {NAMESPACE} (takes a few minutes)")
            irispy.classMethodVoid("HS.Util.Installer.Foundation", "Install", NAMESPACE)
    finally:
        connection.close()

    connection, irispy = native(NAMESPACE)
    try:
        if irispy.classMethodBoolean("HS.FHIRServer.ServiceInstance", "ExistsByUrl", endpoint):
            print(f"FHIR endpoint {endpoint} already exists in {NAMESPACE}")
            return
        print(f"Creating FHIR endpoint {endpoint} in {NAMESPACE}")
        irispy.classMethodVoid("HS.FHIRServer.Installer", "InstallNamespace")
        irispy.classMethodVoid("HS.FHIRServer.Installer", "InstallInstance", endpoint, STRATEGY, METADATA)
        print("Done")
    finally:
        connection.close()


if __name__ == "__main__":
    main()
