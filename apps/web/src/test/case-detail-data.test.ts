/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '../api'
import { documentTextOptions, getCaseOptions, getDocumentFileOptions, getHandoverOptions, getTimeToTreatmentOptions, listDocumentsOptions, listFindingsOptions, listTasksOptions } from '../client/@tanstack/react-query.gen'
import type { Case, Evidence } from '../client/types.gen'
import { referenceCases } from '../mocks/reference'
import { referenceDocuments, referenceFindings, referenceHandover, referenceTexts } from '../mocks/reference-data'
import { treatmentTime } from '../mocks/treatment-time'
import { quoteSegments } from '../screens/CaseDetail/clinical'
import { localDateTime } from '../time'
import { expectApiResponse } from './api-contract'
import { demoState } from './setup'

const options = { path: { case_id: 'vzp-prochazkova' }, headers: { 'X-Actor-Id': 'koordinator' } }

describe('S1 simulated read API', () => {
  it('serves all S1 JSON operations using existing OpenAPI response models', async () => {
    const query = createQueryClient()
    expectApiResponse('get_case', 200, await query.fetchQuery(getCaseOptions(options)))
    expectApiResponse('get_handover', 200, await query.fetchQuery(getHandoverOptions(options)))
    expectApiResponse('list_findings', 200, await query.fetchQuery(listFindingsOptions(options)))
    expectApiResponse('list_tasks', 200, await query.fetchQuery(listTasksOptions(options)))
    expectApiResponse('list_documents', 200, await query.fetchQuery(listDocumentsOptions(options)))
    expectApiResponse('get_time_to_treatment', 200, await query.fetchQuery(getTimeToTreatmentOptions(options)))
    expectApiResponse('document_text', 200, await query.fetchQuery(documentTextOptions({ path: { document_id: '07' } })))
  })

  it('serves exactly the eleven reference documents, each with its original DOCX bytes', async () => {
    const query = createQueryClient()
    const documents = await query.fetchQuery(listDocumentsOptions(options))
    expect(documents).toHaveLength(11)
    expect(documents.filter((item) => item.uploaded_by === 'pl-reznicek').map((item) => item.id)).toEqual(['07'])
    for (const document of documents) {
      const text = await query.fetchQuery(documentTextOptions({ path: { document_id: document.id } }))
      expect(text.text).toBe(readFileSync(`../../data/vzp-structured/reports/${document.filename.replace(/\.docx$/, '.md')}`, 'utf8'))
      const blob = await query.fetchQuery(getDocumentFileOptions({ path: { document_id: document.id }, parseAs: 'blob' }))
      expect(blob).toBeInstanceOf(Blob)
      if (!(blob instanceof Blob)) throw new Error('Expected original file blob')
      const original = readFileSync(`../../data/cesta-pacienta-data/Pacient/${document.filename}`)
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(original))
    }
  })

  it('does not expose reference data or files after resetting to empty, then restores them', async () => {
    const query = createQueryClient()
    demoState.reset('empty')
    await expect(query.fetchQuery(getCaseOptions(options))).rejects.toMatchObject({ status: 404 })
    await expect(query.fetchQuery(getHandoverOptions(options))).rejects.toMatchObject({ status: 404 })
    await expect(query.fetchQuery(getTimeToTreatmentOptions(options))).rejects.toMatchObject({ status: 404 })
    expect(await query.fetchQuery(listDocumentsOptions(options))).toEqual([])
    expect(await query.fetchQuery(listTasksOptions(options))).toEqual([])
    expect(await query.fetchQuery(listFindingsOptions(options))).toEqual([])
    await expect(query.fetchQuery(documentTextOptions({ path: { document_id: '07' } }))).rejects.toMatchObject({ status: 404 })
    await expect(query.fetchQuery(getDocumentFileOptions({ path: { document_id: '07' }, parseAs: 'blob' }))).rejects.toMatchObject({ status: 404 })
    demoState.reset('reference_at_mdt')
    expect(await query.fetchQuery(listDocumentsOptions(options))).toHaveLength(11)
    await expect(query.fetchQuery(getHandoverOptions({ ...options, query: { snapshot: true } }))).rejects.toMatchObject({ status: 404 })
  })

  it('keeps all 65 canonical quotes exact and highlightable without changing the source', () => {
    const visit = (value: unknown): Evidence[] => {
      if (!value || typeof value !== 'object') return []
      if ('document_id' in value && typeof value.document_id === 'string' && 'quote' in value && typeof value.quote === 'string') return [{ document_id: value.document_id, quote: value.quote }]
      return Object.values(value).flatMap(visit)
    }
    const evidence = [...visit(referenceHandover), ...visit(referenceFindings)]
    expect(evidence).toHaveLength(65)
    for (const item of evidence) {
      expect(referenceDocuments.some((document) => document.id === item.document_id)).toBe(true)
      const parts = quoteSegments(referenceTexts[item.document_id], item)
      expect(parts.map((part) => part.text).join('')).toBe(referenceTexts[item.document_id])
      expect(parts.some((part) => part.highlight && part.text === item.quote)).toBe(true)
    }
  })
})

describe('S1 running calendar intervals at the mock boundary', () => {
  const reference = referenceCases[0]
  const now = '2026-10-21T09:00:00'
  it('returns 48 completed, 19 ongoing and 67 total days, and ignores the planned MDT date', () => {
    expect(treatmentTime(reference, now)).toEqual({ t1: 48, t2: 19, t3: null, total: 67 })
    expect(treatmentTime(reference, '2026-10-22T00:00:00').t2).toBe(20)
  })
  it('uses actual endpoints for completed intervals and counts the ongoing treatment wait', () => {
    const item: Case = { ...reference, milestones: { ...reference.milestones, mdt_held: '2026-10-21' } }
    expect(treatmentTime(item, '2026-10-23T09:00:00')).toEqual({ t1: 48, t2: 19, t3: 2, total: 69 })
    expect(treatmentTime({ ...item, milestones: { ...item.milestones, treatment_start: '2026-10-25' } }, '2026-10-28T09:00:00')).toEqual({ t1: 48, t2: 19, t3: 4, total: 71 })
  })
  it('keeps zero, rejects negative waits and never invents a missing milestone or total', () => {
    expect(treatmentTime(reference, '2026-10-02T14:00:00').t2).toBe(0)
    expect(treatmentTime(reference, '2026-10-01T14:00:00')).toEqual({ t1: 48, t2: null, t3: null, total: null })
    expect(treatmentTime({ ...reference, milestones: { ...reference.milestones, symptom_onset: null } }, now)).toEqual({ t1: null, t2: 19, t3: null, total: null })
    expect(treatmentTime({ ...reference, milestones: { symptom_onset: '2026-08-15', mdt_held: '2026-10-21' } }, now)).toEqual({ t1: null, t2: null, t3: 0, total: null })
  })
  it('counts calendar days across DST rather than elapsed 24-hour units', () => {
    const start = localDateTime(new Date(2026, 9, 24, 14))
    const item: Case = { ...reference, milestones: { symptom_onset: '2026-10-24', referred_at: start } }
    expect(treatmentTime(item, '2026-10-26T09:00:00')).toEqual({ t1: 0, t2: 2, t3: null, total: 2 })
  })
})

describe('source quote matching', () => {
  it('uses code-point offsets and falls back safely for incorrect offsets', () => {
    const text = '😀 lék; lék'
    expect(quoteSegments(text, { document_id: 'x', quote: 'lék', start: 2, end: 5 }).filter((item) => item.highlight)).toHaveLength(1)
    expect(quoteSegments(text, { document_id: 'x', quote: 'lék', start: 99, end: 103 }).filter((item) => item.highlight)).toHaveLength(2)
    expect(quoteSegments(text, { document_id: 'x', quote: 'neexistuje' })).toEqual([{ text, highlight: false }])
  })
})
