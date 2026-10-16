"""Vector search in the AI pipeline (S8, Q-I19): chunking and embedding documents, 'ask the case',
MKN-10 code candidates (Q-C11), and flagging quotes not found verbatim with the nearest chunk."""

from __future__ import annotations

import re

from onko_contracts import (
    CaseAnswer,
    CodeCandidate,
    DocChunk,
    Evidence,
    Finding,
    FindingKind,
    ParsedDocument,
    Severity,
    SuggestedAction,
)
from onko_llm_gateway import Gateway
from onko_repository import CaseRepository

from ..models import AnswerDraft, Extraction
from . import prompts
from .quotes import evidence

MAX_CHUNK = 1500  # chars; paragraphs are merged up to this, a longer one is split at line breaks
ASK_CHUNKS = 8  # chunks the model sees for 'ask the case'
CODE_CANDIDATES = 5

_BLANK = re.compile(r"\n[ \t\r\f\v]*\n\s*")


def _blocks(text: str) -> list[tuple[int, int]]:
    """Paragraph spans: text between blank lines, without surrounding whitespace."""
    spans: list[tuple[int, int]] = []
    pos = 0
    for m in [*_BLANK.finditer(text), None]:
        end = len(text) if m is None else m.start()
        piece = text[pos:end]
        if piece.strip():
            lead = len(piece) - len(piece.lstrip())
            spans.append((pos + lead, pos + len(piece.rstrip())))
        if m is not None:
            pos = m.end()
    return spans


def _split_long(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """A paragraph longer than MAX_CHUNK, cut at line breaks (a longer line is cut hard)."""
    spans: list[tuple[int, int]] = []
    begin = start
    while end - begin > MAX_CHUNK:
        cut = text.rfind("\n", begin + 1, begin + MAX_CHUNK)
        cut = cut if cut > begin else begin + MAX_CHUNK
        spans.append((begin, cut))
        begin = cut
        while begin < end and text[begin].isspace():
            begin += 1
    if begin < end:
        spans.append((begin, end))
    return spans


def _is_heading(first_line: str) -> bool:
    """'ZÁVĚR:', 'Anamnéza:', 'DOPORUČENÍ' start a section."""
    line = first_line.strip()
    if not line or len(line) > 80:
        return False
    return line.endswith(":") or (any(c.isalpha() for c in line) and line == line.upper())


def chunk_document(doc: ParsedDocument) -> list[DocChunk]:
    """Split a parsed document along its sections (Q-I19): paragraphs between blank lines, a
    heading starts a new chunk, paragraphs are merged up to MAX_CHUNK. Each chunk is verbatim text
    with its offsets."""
    if doc.meta.case_id is None:
        raise ValueError(f"document {doc.meta.id} has no case")
    text = doc.text
    spans: list[tuple[int, int]] = []
    current: tuple[int, int] | None = None
    for start, end in _blocks(text):
        if end - start > MAX_CHUNK:
            if current:
                spans.append(current)
                current = None
            spans.extend(_split_long(text, start, end))
            continue
        heading = _is_heading(text[start:end].split("\n", 1)[0])
        if current and (heading or end - current[0] > MAX_CHUNK):
            spans.append(current)
            current = None
        current = (current[0], end) if current else (start, end)
    if current:
        spans.append(current)
    return [
        DocChunk(id=f"{doc.meta.id}-{i}", document_id=doc.meta.id, case_id=doc.meta.case_id, ord=i,
                 start=start, end=end, text=text[start:end])
        for i, (start, end) in enumerate(spans)
    ]


def index_document(doc: ParsedDocument, repo: CaseRepository, gateway: Gateway) -> list[DocChunk]:
    """Chunk and embed one document and store its chunks, replacing earlier ones."""
    chunks = chunk_document(doc)
    vectors = gateway.embed([c.text for c in chunks]) if chunks else []
    repo.save_chunks(doc.meta.id, chunks, vectors)
    return chunks


def index_missing(documents: list[ParsedDocument], repo: CaseRepository, gateway: Gateway) -> int:
    """Index the documents that have no chunks yet (e.g. seeded or uploaded before an embedding
    model was configured). Returns how many were indexed."""
    case_ids = {d.meta.case_id for d in documents if d.meta.case_id}
    done = {c.document_id for case_id in case_ids for c in repo.list_chunks(case_id)}
    todo = [d for d in documents if d.meta.id not in done and d.text.strip()]
    for doc in todo:
        index_document(doc, repo, gateway)
    return len(todo)


def ask_case(
    case_id: str,
    question: str,
    documents: list[ParsedDocument],
    repo: CaseRepository,
    gateway: Gateway,
    *,
    limit: int = ASK_CHUNKS,
) -> CaseAnswer:
    """'Ask the case' (Q-I19) over `documents` (the caller's snapshot): the nearest chunks go to
    the model, which may answer only with quotes; every quote is checked verbatim in its document
    like extracted evidence. No quote passes: not found. No similarity cut-off."""
    index_missing(documents, repo, gateway)
    by_id = {d.meta.id: d for d in documents}
    # Every chunk ranked (tens per case, an exact scan anyway), so documents outside the snapshot
    # never crowd out the ones inside it.
    total = len(repo.list_chunks(case_id))
    [vector] = gateway.embed([question])
    ranked = repo.nearest_chunks(case_id, vector, total) if total else []
    chunks = [c for c in ranked if c.document_id in by_id][:limit]
    if not chunks:
        return CaseAnswer(question=question, found=False)

    excerpts = "\n\n".join(f"[document {c.document_id}]\n{c.text}" for c in chunks)
    draft = gateway.complete(
        [
            {"role": "system", "content": prompts.ASK},
            {"role": "user", "content": f"Question: {question}\n\nExcerpts:\n\n{excerpts}"},
        ],
        AnswerDraft,
    )
    quotes: list[Evidence] = []
    for ref in draft.quotes:
        doc = by_id.get(ref.document_id)
        found = evidence(ref.quote, doc) if doc is not None else None
        if found is not None and (found.document_id, found.start) not in {
            (q.document_id, q.start) for q in quotes
        }:
            quotes.append(found)
    return CaseAnswer(question=question, found=bool(quotes), quotes=quotes)


def load_codes(codes: list[CodeCandidate], repo: CaseRepository, gateway: Gateway) -> int:
    """Embed the MKN-10 code list (Q-C12) by its Czech names and store it, replacing the old one."""
    repo.save_codes(codes, gateway.embed([c.title_cs for c in codes]) if codes else [])
    return len(codes)


def code_candidates(
    diagnosis: str, repo: CaseRepository, gateway: Gateway, *, limit: int = CODE_CANDIDATES
) -> list[CodeCandidate]:
    """MKN-10 codes nearest to the diagnosis text, best first (Q-C11). A proposal only."""
    [vector] = gateway.embed([diagnosis])
    return repo.nearest_codes(vector, limit)


def unverified_quote_findings(
    extractions: list[Extraction], repo: CaseRepository | None, gateway: Gateway
) -> list[Finding]:
    """One finding per field claim whose value was dropped because none of its quotes is in the
    document verbatim (D-2), with the nearest chunk of that document as evidence when the document
    is indexed (Q-I19)."""
    findings: list[Finding] = []
    for ex in extractions:
        doc = ex.document
        for claim in ex.output.fields:
            quotes = [q for q in claim.quotes if q.strip()]
            has_value = bool(claim.value and claim.value.strip()) or bool(claim.items)
            if not quotes or not has_value or any(evidence(q, doc) for q in quotes):
                continue
            nearest = _nearest_chunk(quotes[0], doc, repo, gateway)
            shown = quotes[0] if len(quotes[0]) <= 200 else quotes[0][:200] + "…"
            findings.append(
                Finding(
                    id=f"unverified:{claim.path.value}:{doc.meta.id}",
                    kind=FindingKind.UNVERIFIED_QUOTE,
                    severity=Severity.INFO,
                    fields=[claim.path.value],
                    message_cs=f"Citace „{shown}“ není v dokumentu doslova, hodnota nebyla "
                    "převzata. Zkontrolujte nejbližší úsek dokumentu.",
                    evidence=[nearest] if nearest else [],
                    suggested_action=SuggestedAction.REVIEW,
                )
            )
    return findings


def _nearest_chunk(
    quote: str, doc: ParsedDocument, repo: CaseRepository | None, gateway: Gateway
) -> Evidence | None:
    if repo is None or not gateway.can_embed or doc.meta.case_id is None:
        return None
    [vector] = gateway.embed([quote])
    found = repo.nearest_chunks(doc.meta.case_id, vector, 1, document_id=doc.meta.id)
    if not found:
        return None
    chunk = found[0]
    return Evidence(document_id=chunk.document_id, quote=chunk.text,
                    document_date=doc.meta.document_date, start=chunk.start, end=chunk.end)
