"""Duplicate uploads (Q-I22): exact copies by SHA-256, near copies by word-shingle overlap."""

from __future__ import annotations

from datetime import datetime

from onko_contracts import Case, DocumentMeta, DuplicateKind
from onko_documents import find_duplicates, sha256
from onko_documents.service import NEAR_DUPLICATE, shingles, similarity
from onko_repository import InMemoryRepository

REPORT = (
    "CT břicha ze dne 8. 10. 2026. Nález: hypodenzní ložisko v hlavě pankreatu velikosti 35 mm "
    "s kontaktem s VMS, dilatace ductus choledochus 14 mm, bez jaterních metastáz. Závěr: tumor "
    "hlavy pankreatu, doporučeno EUS s biopsií a prezentace na MDT."
)
# The same report template from the same department, another patient and finding
TEMPLATE = (
    "CT břicha ze dne 2. 9. 2026. Nález: bez ložiskových změn pankreatu, játra bez ložisek, "
    "žlučové cesty nedilatované, volná tekutina nepřítomna. Závěr: přiměřený nález, kontrola "
    "dle klinického stavu."
)


def _repo(*docs: tuple[str, bytes, str]) -> InMemoryRepository:
    repo = InMemoryRepository()
    repo.save_case(Case(id="c", patient_name="P", koc_id="koc", referring_doctor_id="pl",
                        created_at=datetime(2026, 10, 1)))
    for doc_id, data, text in docs:
        repo.save_document(DocumentMeta(id=doc_id, case_id="c", filename=f"{doc_id}.docx"), data, text)
    return repo


def test_identical_bytes_are_an_exact_duplicate():
    repo = _repo(("08", b"bytes of 08", REPORT))
    [match] = find_duplicates(repo, "c", b"bytes of 08", REPORT)
    assert (match.document_id, match.kind, match.similarity) == ("08", DuplicateKind.EXACT, 1.0)


def test_the_same_report_sent_again_by_someone_else_is_a_near_duplicate():
    resent = REPORT.replace("Závěr:", "ZÁVĚR:\u00a0") + "\nOdesláno z ambulance PL."
    repo = _repo(("08", b"facility copy", REPORT))
    [match] = find_duplicates(repo, "c", b"gp copy", resent)
    assert match.kind is DuplicateKind.NEAR and match.similarity >= NEAR_DUPLICATE


def test_reports_sharing_a_template_are_not_duplicates():
    repo = _repo(("08", b"08", REPORT))
    assert find_duplicates(repo, "c", b"other", TEMPLATE) == []


def test_only_the_case_s_own_documents_are_compared():
    repo = _repo(("08", b"08", REPORT))
    repo.save_case(Case(id="other", patient_name="Q", koc_id="koc", referring_doctor_id="pl",
                        created_at=datetime(2026, 10, 1)))
    assert find_duplicates(repo, "other", b"08", REPORT) == []


def test_shingles_ignore_case_and_whitespace():
    assert shingles("Tumor  hlavy\npankreatu 35 mm") == shingles("tumor hlavy pankreatu 35 MM")
    assert similarity(shingles("a b"), set()) == 0.0
    assert sha256(b"x") == "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"
