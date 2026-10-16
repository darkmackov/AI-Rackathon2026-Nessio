import { useRef, useState } from 'react'
import type { DocumentMeta, Finding, Handover } from '../../client/types.gen'
import { handoverFields, type SourceSelection } from './clinical'

/** Keep only a pointer to the selected source; clinical data stays in Query. */
export function useDocumentSources(handover?: Handover, documents?: DocumentMeta[], findings?: Finding[]) {
  const [selection, setSelection] = useState<SourceSelection | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const openSource = (source: SourceSelection, element: HTMLButtonElement) => { trigger.current = element; setSelection(source) }
  const closeSource = () => { setSelection(null); if (trigger.current?.isConnected) trigger.current.focus() }
  const evidence = selection && !('documentId' in selection) ? (
    selection.kind === 'field' ? handover && handoverFields(handover)[selection.path]?.evidence?.[selection.index]
      : selection.kind === 'examination' ? handover?.examinations?.[selection.row]?.evidence?.[selection.index]
        : selection.kind === 'lab' ? handover?.labs?.[selection.row]?.evidence?.[selection.index]
          : findings?.find((finding) => finding.id === selection.id)?.evidence?.[selection.index]
  ) : undefined
  const selectedDocument = selection && documents?.find((document) => document.id === ('documentId' in selection ? selection.documentId : evidence?.document_id))
  const documentNames = Object.fromEntries((documents ?? []).map((document) => [document.id, document.title ?? document.filename]))
  return { selection, setSelection, openSource, closeSource, evidence, selectedDocument, sources: { openSource, documentNames, selection } }
}
