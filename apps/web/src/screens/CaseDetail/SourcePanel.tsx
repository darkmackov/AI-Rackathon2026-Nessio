import { Alert, Button, Drawer, Group, Mark, Paper, Stack, Text, Title } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { documentTextOptions } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta, Evidence } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import { useSession } from '../../session'
import { CopySection } from './ClinicalValue'
import { DownloadOriginal, MissingDocument } from './DocumentsTab'
import { quoteSegments } from './clinical'

export default function SourcePanel({ document, evidence, close, fallback }: { document?: DocumentMeta; evidence?: Evidence; close: () => void; fallback?: ReactNode }) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const wide = useMediaQuery('(min-width: 75em)')
  const query = useQuery({ ...documentTextOptions({ path: { document_id: document?.id ?? '' }, headers: actorHeaders(actorId ?? '') }), enabled: !!document })
  const text = query.data?.text ?? ''
  const segments = quoteSegments(text, evidence)
  const content = <Stack gap="md">
    <Group justify="space-between" align="flex-start" style={wide ? { position: 'sticky', top: 0, zIndex: 1, background: 'var(--mantine-color-body)', paddingBlock: 8 } : undefined}><Title order={2} size="h3" tabIndex={-1} ref={(node) => { node?.focus({ preventScroll: true }) }}>{t('s1.source')}</Title>{wide && <Button variant="outline" onClick={close}>{t('s1.closeSource')}</Button>}</Group>
    {!document ? fallback ?? <MissingDocument /> : <>
    <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{document.title ?? document.filename}</Text>
    <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{document.filename}</Text>
    <DownloadOriginal document={document} />
    {evidence && <Paper withBorder p="sm"><Text size="sm" component="blockquote" m={0} style={{ whiteSpace: 'pre-wrap' }}>{evidence.quote}</Text></Paper>}
    {query.isPending && <LoadingState />}
    {query.isError && <QueryError error={query.error} pending={query.isFetching} retry={() => { void query.refetch() }} />}
    {query.isSuccess && !text && <EmptyState title={t('s1.noText')} />}
    {query.isSuccess && text && <>
      {evidence && !segments.some((part) => part.highlight) && <Alert color="orange" role="status">{t('s1.quoteMissing')}</Alert>}
      <CopySection text={() => text} />
      <Text component="div" size="sm" data-testid="document-text" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {segments.map((part, index) => part.highlight ? <Mark key={index} color="yellow" ref={(node) => { if (!segments.slice(0, index).some((segment) => segment.highlight)) node?.scrollIntoView?.({ block: 'center' }) }}>{part.text}</Mark> : <span key={index}>{part.text}</span>)}
      </Text>
    </>}
    </>}
  </Stack>
  return wide ? <Paper component="aside" withBorder p="md" aria-label={t('s1.source')} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }} style={{ position: 'sticky', top: 16, maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto' }}>{content}</Paper>
    : <Drawer opened onClose={close} position="right" size="100%" title={t('s1.source')} closeButtonProps={{ 'aria-label': t('s1.closeSource') }}>{content}</Drawer>
}
