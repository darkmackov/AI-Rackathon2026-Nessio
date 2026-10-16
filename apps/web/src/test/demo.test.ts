/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '../api'
import { documentTextOptions, getDocumentFileOptions, listDocumentsOptions } from '../client/@tanstack/react-query.gen'
import { actors, boards, organizations } from '../mocks/directory'
import { validLocalDateTime } from '../time'

// The labelled demo (Q-W6) must stay identical to the canonical data it was built from.
describe('demo data', () => {
  it('matches the canonical demo directory', () => {
    const directory = JSON.parse(readFileSync('../../data/demo/directory.json', 'utf8'))
    expect({ actors, organizations, mdt_boards: boards }).toEqual({ actors: directory.actors, organizations: directory.organizations, mdt_boards: directory.mdt_boards })
  })

  it('serves exactly the eleven reference documents with their canonical text and original DOCX bytes', async () => {
    const query = createQueryClient()
    const documents = await query.fetchQuery(listDocumentsOptions({ path: { case_id: 'vzp-prochazkova' }, headers: { 'X-Actor-Id': 'koordinator' } }))
    expect(documents).toHaveLength(11)
    expect(documents.filter((item) => item.uploaded_by === 'pl-reznicek').map((item) => item.id)).toEqual(['07'])
    for (const document of documents) {
      const text = await query.fetchQuery(documentTextOptions({ path: { document_id: document.id } }))
      // A Windows checkout may convert the Markdown sources to CRLF; the served text uses LF.
      const canonical = readFileSync(`../../data/vzp-structured/reports/${document.filename.replace(/\.docx$/, '.md')}`, 'utf8').replace(/\r\n/g, '\n')
      expect(text.text).toBe(canonical)
      const blob = await query.fetchQuery(getDocumentFileOptions({ path: { document_id: document.id }, parseAs: 'blob' }))
      if (!(blob instanceof Blob)) throw new Error('Expected original file blob')
      const original = readFileSync(`../../data/cesta-pacienta-data/Pacient/${document.filename}`)
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(original))
    }
  })
})

describe('local date and time input', () => {
  it('accepts local datetimes and rejects invalid dates and UTC values', () => {
    expect(validLocalDateTime('2026-10-21T09:00')).toBe(true)
    expect(validLocalDateTime('2026-02-30T09:00')).toBe(false)
    expect(validLocalDateTime('2026-10-21T09:00:00Z')).toBe(false)
    expect(validLocalDateTime('')).toBe(false)
  })
})