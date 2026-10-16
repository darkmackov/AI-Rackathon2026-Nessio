"""The demo directory must be valid, internally consistent and match the reference case."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from onko_contracts import Actor, MdtBoard, Organization, OrganizationKind
from pydantic import TypeAdapter

ROOT = Path(__file__).resolve().parents[3]
DIRECTORY = ROOT / "data" / "demo" / "directory.json"
MDT_ZAVER = ROOT / "data" / "vzp-structured" / "brief" / "MDT zaver.md"


@pytest.fixture(scope="module")
def directory():
    raw = json.loads(DIRECTORY.read_text(encoding="utf-8"))
    return (
        TypeAdapter(list[Organization]).validate_python(raw["organizations"]),
        TypeAdapter(list[Actor]).validate_python(raw["actors"]),
        TypeAdapter(list[MdtBoard]).validate_python(raw["mdt_boards"]),
    )


def test_ids_unique_and_references_resolve(directory):
    orgs, actors, boards = directory
    org_ids = [o.id for o in orgs]
    actor_ids = [a.id for a in actors]
    assert len(set(org_ids)) == len(org_ids)
    assert len(set(actor_ids)) == len(actor_ids)
    assert all(a.organization_id in org_ids for a in actors)
    assert all(b.organization_id in org_ids for b in boards)
    assert all(m.actor_id in actor_ids for b in boards for m in b.members if m.actor_id)


def test_enough_for_the_demo(directory):
    orgs, actors, boards = directory
    kocs = {o.id for o in orgs if o.kind is OrganizationKind.KOC}
    assert len(kocs) >= 3
    assert len([a for a in actors if a.role == "referring_doctor"]) >= 3
    assert kocs <= {a.organization_id for a in actors if a.role == "coordinator"}, "a coordinator per KOC"
    assert {b.organization_id for b in boards} <= kocs


def test_reference_case_ids_exist(directory):
    orgs, actors, _ = directory
    assert {"koc2-lipova", "koc1-severni", "zp-211"} <= {o.id for o in orgs}
    assert {"pl-reznicek", "koordinator"} <= {a.id for a in actors}
    gp = next(a for a in actors if a.id == "pl-reznicek")
    assert gp.email is None, "finding F03: the GP's email is missing in the documents"


def test_git_board_matches_sample_conclusion(directory):
    _, _, boards = directory
    text = MDT_ZAVER.read_text(encoding="utf-8")
    section = text.split("ČLENOVÉ MDT", 1)[1].split("DIAGNÓZA", 1)[0]
    expected = [re.split(r"\s+–\s+", line.strip())[0] for line in section.strip().splitlines() if line.strip()]
    git = next(b for b in boards if b.id == "mdt-git-lipova")
    assert [m.name for m in git.members] == expected
