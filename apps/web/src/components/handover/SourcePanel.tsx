import { Alert, Button, Drawer, EmptyState, Group, Mark, Paper, Stack, Table, Text, Title } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { IconFileSearch } from '@tabler/icons-react'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { documentTextOptions } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta, Evidence } from '../../client/types.gen'
import LoadingState, { EmptyState as NoData, QueryError } from '../DataState'
import { useSession } from '../../session'
import { CopySection } from './ClinicalValue'
import { DownloadOriginal, MissingDocument } from '../documents/DocumentsTab'
import { documentBlocks, quoteSegments, type TextPiece } from './clinical'

// The side column sticks below the sticky case header and scrolls on its own.
const sideColumn: CSSProperties = { position: 'sticky', top: 'calc(var(--case-header-height, 0px) + 16px)', maxHeight: 'calc(100dvh - var(--case-header-height, 0px) - 32px)', overflowY: 'auto' }

// Scrolls only the panel's own scroll container, never the window, so the page does not jump.
function scrollToMark(mark: HTMLElement | null) {
  let box = mark?.parentElement
  while (box && box !== document.documentElement && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement
  if (!mark || !box || box === document.documentElement) return
  box.scrollTop += mark.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3
}

const focusTitle = (node: HTMLHeadingElement | null) => { node?.focus({ preventScroll: true }) }

const textStyle: CSSProperties = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }

// Plain text keeps its line breaks; Markdown tables from Word documents render as tables. The first highlight scrolls into view.
function DocumentText({ pieces }: { pieces: TextPiece[] }) {
  const blocks = documentBlocks(pieces)
  const first = blocks.flatMap((block) => block.kind === 'text' ? block.pieces : [...block.header, ...block.rows.flat()].flat()).find((part) => part.highlight)
  const spans = (cell: TextPiece[]) => cell.map((part, index) => part.highlight ? <Mark key={index} color="yellow" ref={part === first ? scrollToMark : undefined}>{part.text}</Mark> : <span key={index}>{part.text}</span>)
  return <Stack gap="sm" data-testid="document-text">
    {blocks.map((block, index) => block.kind === 'text'
      ? <Text key={index} component="div" size="sm" style={textStyle}>{spans(block.pieces)}</Text>
      : <Table.ScrollContainer key={index} minWidth={block.header.length * 110}><Table withTableBorder withColumnBorders verticalSpacing={4} horizontalSpacing="xs" fz="sm">
        <Table.Thead><Table.Tr>{block.header.map((cell, column) => <Table.Th key={column}>{spans(cell)}</Table.Th>)}</Table.Tr></Table.Thead>
        <Table.Tbody>{block.rows.map((row, rowIndex) => <Table.Tr key={rowIndex}>{row.map((cell, column) => <Table.Td key={column}>{spans(cell)}</Table.Td>)}</Table.Tr>)}</Table.Tbody>
      </Table></Table.ScrollContainer>)}
  </Stack>
}

export function SourcePlaceholder() {
  const { t } = useTranslation()
  return <Paper withBorder p="md" style={sideColumn}>
    <EmptyState icon={<IconFileSearch size={28} aria-hidden />} title={t('caseDetail.sourcePlaceholder')} description={t('caseDetail.sourcePlaceholderHelp')} />
  </Paper>
}

export default function SourcePanel({ document, evidence, close, fallback }: { document?: DocumentMeta; evidence?: Evidence; close: () => void; fallback?: ReactNode }) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const wide = useMediaQuery('(min-width: 75em)')
  const query = useQuery({ ...documentTextOptions({ path: { document_id: document?.id ?? '' }, headers: actorHeaders(actorId ?? '') }), enabled: !!document })
  const text = query.data?.text ?? ''
  const segments = quoteSegments(text, evidence)
  const quoteFound = segments.some((part) => part.highlight)
  const content = <Stack gap="sm">
    <Group justify="space-between" align="flex-start" style={wide ? { position: 'sticky', top: 0, zIndex: 1, background: 'var(--mantine-color-body)', paddingBlock: 8 } : undefined}><Title order={2} size="h4" tabIndex={-1} ref={focusTitle}>{t('caseDetail.source')}</Title>{wide && <Button variant="outline" size="xs" onClick={close}>{t('caseDetail.closeSource')}</Button>}</Group>
    {!document ? fallback ?? <MissingDocument /> : <>
    <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{document.title ?? document.filename}</Text>
    <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{document.filename}</Text>
    <DownloadOriginal document={document} />
    {evidence && <Paper withBorder p="sm"><Text size="sm" component="blockquote" m={0} style={{ whiteSpace: 'pre-wrap' }}>{evidence.quote}</Text></Paper>}
    {query.isPending && <LoadingState rows={6} />}
    {query.isError && <QueryError error={query.error} pending={query.isFetching} retry={() => { void query.refetch() }} />}
    {query.isSuccess && !text && <NoData title={t('caseDetail.noText')} />}
    {query.isSuccess && text && <>
      {evidence && !quoteFound && <Alert color="orange" role="status">{t('caseDetail.quoteMissing')}</Alert>}
      <CopySection text={() => text} />
      <DocumentText pieces={segments} />
    </>}
    </>}
  </Stack>
  return wide ? <Paper component="aside" withBorder p="md" pt={0} aria-label={t('caseDetail.source')} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }} style={sideColumn}>{content}</Paper>
    : <Drawer opened onClose={close} position="right" size="100%" title={t('caseDetail.source')} closeButtonProps={{ 'aria-label': t('caseDetail.closeSource') }}>{content}</Drawer>
}