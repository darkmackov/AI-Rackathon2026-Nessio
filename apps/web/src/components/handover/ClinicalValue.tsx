import { Alert, Anchor, Badge, Box, Button, Grid, Group, HoverCard, Paper, SimpleGrid, Stack, Text, type MantineSize } from '@mantine/core'
import { IconArrowRight, IconFileText, IconPencil, IconSparkles } from '@tabler/icons-react'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Evidence, Finding, SourcedStr, Stamp } from '../../client/types.gen'
import PersonChip from '../PersonChip'
import { SeverityBadge } from '../Severity'
import { formatDateTime } from '../../time'
import { displayValue, sameSelection, type SourceSelection, type SourcedValue } from './clinical'
import { statusMeta } from './status-meta'
import { notifyError, notifySuccess } from '../../notifications/notify'

export type OpenSource = (selection: SourceSelection, trigger: HTMLButtonElement) => void
/** What every source chip needs: open a source, name its document, and know which source is open. */
export type Sources = { openSource: OpenSource; documentNames: Record<string, string>; selection: SourceSelection | null }

export function CopySection({ text }: { text: () => string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return <Stack gap="xs"><Button variant="outline" size="compact-sm" onClick={async () => {
    try { await navigator.clipboard.writeText(text()); setCopied(true); notifySuccess('clipboard', t('caseDetail.copied')) }
    catch { setCopied(false); notifyError('clipboard', t('caseDetail.copyError')) }
  }}>{t('caseDetail.copy')}</Button>{copied && <Text size="sm" role="status">{t('caseDetail.copied')}</Text>}</Stack>
}

export function StampView({ stamp, size = 'sm' }: { stamp?: Stamp | null; names?: Record<string, string>; size?: MantineSize }) {
  const { t, i18n } = useTranslation()
  if (!stamp) return <Text size={size} c="dimmed">{t('caseDetail.notConfirmed')}</Text>
  return <PersonChip id={stamp.by} size={size === 'xs' ? 'xs' : 'sm'} secondary={<time dateTime={stamp.at}>{formatDateTime(stamp.at, i18n.language)}</time>} />
}

export function Provenance({ value, names }: { value: Pick<SourcedStr, 'origin' | 'entered'>; names: Record<string, string> }) {
  const { t } = useTranslation()
  if ((value.origin ?? 'ai') === 'ai') return <Badge size="sm" variant="light" color="violet" c="violet.9" leftSection={<IconSparkles size={12} aria-hidden />}>{t('caseDetail.ai')}</Badge>
  return <Group gap={6} wrap="wrap">
    <Badge size="sm" variant="light" color="gray" c="dark.9" leftSection={<IconPencil size={12} aria-hidden />}>{t('caseDetail.manual')}</Badge>
    <StampView stamp={value.entered} names={names} size="xs" />
  </Group>
}

/** A source as a chip: the document it comes from, the quote on hover, the highlighted source on click. */
export function SourceChip({ label, name, quote, active, onClick }: { label: string; name: string; quote?: string; active: boolean; onClick: (trigger: HTMLButtonElement) => void }) {
  const chip = <Button variant={active ? 'filled' : 'light'} size="compact-sm" radius="xl" maw={240} aria-label={name} aria-pressed={active}
    leftSection={<IconFileText size={14} aria-hidden />} onClick={(event) => onClick(event.currentTarget)}>
    <Text component="span" inherit truncate="end">{label}</Text>
  </Button>
  if (!quote) return chip
  return <HoverCard width={320} shadow="md" openDelay={300} position="top-start" withArrow>
    <HoverCard.Target>{chip}</HoverCard.Target>
    <HoverCard.Dropdown><Stack gap={4}>
      <Text size="xs" fw={600}>{name}</Text>
      <Text size="sm" component="blockquote" m={0} style={{ whiteSpace: 'pre-wrap' }}>{quote}</Text>
    </Stack></HoverCard.Dropdown>
  </HoverCard>
}

export function EvidenceLinks({ evidence = [], select, sources, quotes = false }: { evidence?: Evidence[]; select: (index: number) => SourceSelection; sources: Sources; quotes?: boolean }) {
  const { t } = useTranslation()
  if (!evidence.length) return null
  const chip = (item: Evidence, index: number, withQuote: boolean) => {
    const document = sources.documentNames[item.document_id] ?? t('unavailable')
    return <SourceChip label={document} name={t('caseDetail.sourceNumber', { number: index + 1, document })} quote={withQuote ? item.quote : undefined}
      active={sameSelection(sources.selection, select(index))} onClick={(trigger) => sources.openSource(select(index), trigger)} />
  }
  // Competing values side by side, each with its own quote and source (UX-3).
  if (quotes) return <SimpleGrid cols={{ base: 1, sm: Math.min(evidence.length, 2) }} spacing="xs" role="group" aria-label={t('caseDetail.sources')}>
    {evidence.map((item, index) => <Paper key={`${item.document_id}-${index}`} withBorder p="xs" bg="red.0"><Stack gap={6} align="flex-start">
      <Text component="blockquote" size="sm" fw={500} m={0} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.quote}</Text>
      {chip(item, index, false)}
    </Stack></Paper>)}
  </SimpleGrid>
  return <Group gap={6} role="group" aria-label={t('caseDetail.sources')}>{evidence.map((item, index) => <span key={`${item.document_id}-${index}`}>{chip(item, index, true)}</span>)}</Group>
}

export function StatusBadge({ status }: { status: SourcedValue['status'] }) {
  const { t } = useTranslation()
  const value = status ?? 'missing'
  const { color, icon: StatusIcon } = statusMeta[value]
  return <Badge size="sm" variant={value === 'found' ? 'transparent' : 'light'} color={color} c="dark.9" px={value === 'found' ? 0 : undefined}
    leftSection={<StatusIcon size={14} color={`var(--mantine-color-${color}-8)`} aria-hidden />}>{t(`caseDetail.${value}`)}</Badge>
}

/** Unresolved findings that concern one value, each linking to its place in the worklist. */
export function InlineFindings({ findings, showFinding }: { findings: Finding[]; showFinding: (id: string) => void }) {
  const { t } = useTranslation()
  if (!findings.length) return null
  return <Stack gap={4}>{findings.map((finding) => <Group key={finding.id} gap="xs" align="flex-start">
    <SeverityBadge severity={finding.severity} size="sm" />
    <Text size="sm" style={{ flex: '1 1 16rem', minWidth: 0 }}>{finding.message_cs}</Text>
    <Anchor href={`#finding-${finding.id}`} size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
      onClick={(event) => { event.preventDefault(); showFinding(finding.id) }}>{t('caseDetail.toWorklist')}<IconArrowRight size={14} aria-hidden /></Anchor>
  </Group>)}</Stack>
}

const focusField = (node: HTMLDivElement | null) => { node?.focus({ preventScroll: true }); node?.scrollIntoView?.({ block: 'center' }) }

export default function ClinicalValue({ label, path, value, names, sources, findings, showFinding, formatted, actions, focused = false, idPrefix = 'field' }: {
  label: string; path: string; value?: SourcedValue; names: Record<string, string>; sources: Sources; findings: Finding[]; showFinding: (id: string) => void; formatted?: string;
  actions?: ReactNode; focused?: boolean; idPrefix?: string;
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const status = value?.status ?? 'missing'
  // A found empty value ('' or []) is shown explicitly, never as a blank (UX-3).
  const shown = value?.value != null ? formatted ?? displayValue(value.value) : null
  return <Box id={`${idPrefix}-${path}`} role="group" aria-labelledby={labelId} tabIndex={-1} ref={focused ? focusField : undefined} py="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
    <Grid gap="xs">
      <Grid.Col span={{ base: 12, sm: 4 }}>
        <Text fw={600} size="sm" id={labelId}>{label}</Text>
        <Group gap={6} mt={4}><StatusBadge status={status} />{value && <Provenance value={value} names={names} />}</Group>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 8 }}><Stack gap={6}>
        <Text size="sm" c={shown ? undefined : 'dimmed'} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shown === null ? '—' : shown || t('caseDetail.emptyValue')}</Text>
        {value?.note && <Alert color={status === 'conflict' ? 'red' : 'gray'} p="xs"><Text size="sm">{value.note}</Text></Alert>}
        <EvidenceLinks evidence={value?.evidence} select={(index) => ({ kind: 'field', path, index })} sources={sources} quotes={status === 'conflict'} />
        <InlineFindings findings={findings} showFinding={showFinding} />
        {actions}
      </Stack></Grid.Col>
    </Grid>
  </Box>
}
