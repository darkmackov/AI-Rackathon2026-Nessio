"""The in-memory fake is the behavioural reference for every adapter (PER-3)."""

from __future__ import annotations

from datetime import datetime

import pytest
from onko_contracts import Actor, Case, MdtBoard, Organization, OrganizationKind
from onko_repository import InMemoryRepository


def test_directory_round_trip():
    repo = InMemoryRepository()
    org = Organization(id="koc-a", name="KOC A", kind=OrganizationKind.KOC)
    actor = Actor(id="coord-a", name="Koordinátor A", role="coordinator", organization_id="koc-a")
    board = MdtBoard(id="mdt-a", name="MDT A", organization_id="koc-a")
    repo.save_organization(org)
    repo.save_actor(actor)
    repo.save_mdt_board(board)

    assert repo.list_organizations() == [org]
    assert repo.get_actor("coord-a") == actor
    assert repo.list_actors() == [actor]
    assert repo.get_mdt_board("mdt-a") == board
    assert repo.list_mdt_boards() == [board]


def test_save_replaces_by_id():
    repo = InMemoryRepository()
    board = MdtBoard(id="mdt-a", name="MDT A", organization_id="koc-a")
    repo.save_mdt_board(board)
    repo.save_mdt_board(board.model_copy(update={"name": "MDT A2"}))
    assert [b.name for b in repo.list_mdt_boards()] == ["MDT A2"]


@pytest.mark.parametrize("getter", ["get_actor", "get_mdt_board", "get_case"])
def test_get_unknown_raises_key_error(getter):
    with pytest.raises(KeyError):
        getattr(InMemoryRepository(), getter)("missing")


def test_clear_removes_everything():
    repo = InMemoryRepository()
    repo.save_organization(Organization(id="koc-a", name="KOC A", kind=OrganizationKind.KOC))
    repo.save_actor(Actor(id="gp-a", name="MUDr. A", role="referring_doctor"))
    repo.save_mdt_board(MdtBoard(id="mdt-a", name="MDT A", organization_id="koc-a"))
    repo.save_case(Case(
        id="case-a", patient_name="Pacient A", koc_id="koc-a", referring_doctor_id="gp-a",
        created_at=datetime(2026, 1, 1),
    ))

    repo.clear()

    assert repo.list_organizations() == []
    assert repo.list_actors() == []
    assert repo.list_mdt_boards() == []
    assert repo.list_cases() == []
