import { Alert, Blockquote, Button, Drawer, Mark, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useId } from 'react'
import { actorHeaders } from '../../api'
import { documentTextOptions, getDocumentFileOptions } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../DataState'
import { quoteRange, type SourceSelection } from './document-utils'

const scrollToQuote = (node: HTMLElement | null) => { node?.scrollIntoView?.({ block: 'center' }) }

export default function SourceDocument({ selection, documents, actorId, onClose }: {
  selection: SourceSelection | null; documents: DocumentMeta[]; actorId: string; onClose: () => void;
}) {
  const { t } = useTranslation()
  const stackId = useId()
  const document = documents.find((item) => item.id === selection?.documentId)
  const options = { headers: actorHeaders(actorId), path: { document_id: selection?.documentId ?? '' } }
  const text = useQuery({ ...documentTextOptions(options), enabled: selection !== null })
  const file = useQuery({ ...getDocumentFileOptions({ ...options, parseAs: 'blob' }), enabled: false, gcTime: 0 })
  const content = text.data?.text
  const range = content ? quoteRange(content, selection?.evidence) : null

  async function download() {
    if (!selection) return
    const result = await file.refetch()
    if (!result.data || result.isError) return
    const url = URL.createObjectURL(result.data)
    try {
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = document?.filename ?? selection.documentId
      anchor.click()
    } finally { URL.revokeObjectURL(url) }
  }

  return <Drawer stackId={stackId} opened={selection !== null} onClose={onClose} position="right" size="xl" title={document?.title ?? document?.filename ?? t('documents.source')}
    closeButtonProps={{ 'aria-label': t('close') }}>
    <Stack>
      <Button variant="outline" loading={file.isFetching} onClick={() => { void download() }}>{t('documents.original')}</Button>
      {file.isError && <QueryError error={file.error} retry={() => { void download() }} pending={file.isFetching} />}
      {selection?.evidence && <Blockquote cite={t('documents.quote')}>{selection.evidence.quote}</Blockquote>}
      {text.isPending && <LoadingState />}
      {text.isError && <QueryError error={text.error} retry={() => { void text.refetch() }} pending={text.isFetching} />}
      {text.isSuccess && (!content ? <EmptyState title={t('documents.noText')} /> : <>
        {selection?.evidence && !range && <Alert color="yellow" role="status">{t('documents.quoteNotFound')}</Alert>}
        <Text component="div" size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {range ? <>{content.slice(0, range.start)}<Mark ref={scrollToQuote}>{content.slice(range.start, range.end)}</Mark>{content.slice(range.end)}</> : content}
        </Text>
      </>)}
    </Stack>
  </Drawer>
}
