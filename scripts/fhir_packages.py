"""Fetch the FHIR IG packages from data-model.md › Packages, with their dependencies (Q-I6).

Usage:
    uv run python scripts/fhir_packages.py download

Downloads into fhir-packages/<name>#<version>/ (git-ignored) from packages.fhir.org and reports the
dependencies the registry does not have (known: hl7.fhir.cz.terminology 0.3.0). `hl7.fhir.r4.core`
ships with IRIS for Health and is skipped.
"""

from __future__ import annotations

import io
import json
import sys
import tarfile
from pathlib import Path

import httpx

REGISTRY = "https://packages.fhir.org"
TARGET = Path(__file__).resolve().parents[1] / "fhir-packages"
ROOTS = [("hl7.fhir.cz.core", "1.0.0"), ("hl7.fhir.cz.lab", "1.0.0"), ("hl7.fhir.cz.img", "1.0.0")]
BUILT_IN = {"hl7.fhir.r4.core"}


def download(client: httpx.Client, name: str, version: str) -> dict[str, str] | None:
    """Unpack one package and return its dependencies, or None if the registry lacks it."""
    folder = TARGET / f"{name}#{version}"
    manifest = folder / "package" / "package.json"
    if not manifest.exists():
        response = client.get(f"{REGISTRY}/{name}/{version}")
        if response.status_code == 404:
            return None
        response.raise_for_status()
        folder.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(response.content), mode="r:gz") as archive:
            archive.extractall(folder, filter="data")
    return json.loads(manifest.read_text(encoding="utf-8")).get("dependencies", {})


def main() -> None:
    if sys.argv[1:] != ["download"]:
        raise SystemExit(__doc__)
    queue = list(ROOTS)
    seen: set[tuple[str, str]] = set()
    missing = []
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        while queue:
            name, version = queue.pop(0)
            if (name, version) in seen or name in BUILT_IN:
                continue
            seen.add((name, version))
            dependencies = download(client, name, version)
            if dependencies is None:
                missing.append(f"{name}#{version}")
                continue
            print(f"ok  {name}#{version}")
            queue.extend(dependencies.items())
    for package in missing:
        print(f"MISSING on the registry: {package}")
    print(f"Packages in {TARGET}")


if __name__ == "__main__":
    main()
