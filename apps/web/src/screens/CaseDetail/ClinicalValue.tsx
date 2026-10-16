import { Alert, Badge, Box, Button, Grid, Group, Stack, Text, type MantineSize } from '@mantine/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Evidence, SourcedStr, Stamp } from '../../client/types.gen'
import { formatDateTime } from '../../time'
import { displayValue, type SourceSelection, type SourcedValue } from './clinical'

export type OpenSource = (selection: SourceSelection, trigger: HTMLButtonElement) => void

export function CopySection({ text }: { text: () => string }) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<'copied' | 'copyError' | null>(null)
  return <Stack gap="xs"><Button variant="outline" size="compact-sm" onClick={async () => {
    try { await navigator.clipboard.writeText(text()); setFeedback('copied') } catch { setFeedback('copyError') }
  }}>{t('caseDetail.copy')}</Button>{feedback && <Text size="sm" c={feedback === 'copyError' ? 'red.9' : undefined} role={feedback === 'copyError' ? 'alert' : 'status'}>{t(`caseDetail.${feedback}`)}</Text>}</Stack>
}

export function StampView({ stamp, names, size = 'sm' }: { stamp?: Stamp | null; names: Record<string, string>; size?: MantineSize }) {
  const { t, i18n } = useTranslation()
  return <Text size={size}>{stamp ? `${names[stamp.by] ?? t('unavailable')} · ${formatDateTime(stamp.at, i18n.language)}` : t('caseDetail.notConfirmed')}</Text>
}

export function Provenance({ value, names }: { value: Pick<SourcedStr, 'origin' | 'entered'>; names: Record<string, string> }) {
  const { t } = useTranslation()
  const origin = value.origin ?? 'ai'
  return <Group gap="xs" wrap="wrap">
    <Badge size="sm" variant="outline" color={origin === 'ai' ? 'violet' : 'gray'} c="dark.9">{t(`caseDetail.${origin}`)}</Badge>
    {origin === 'manual' && <Group gap={4}><Text size="xs">{t('caseDetail.enteredBy')}:</Text><StampView stamp={value.entered} names={names} size="xs" /></Group>}
  </Group>
}

export function EvidenceLinks({ evidence = [], select, openSource, documentNames, quotes = false }: { evidence?: Evidence[]; select: (index: number) => SourceSelection; openSource: OpenSource; documentNames: Record<string, string>; quotes?: boolean }) {
  const { t } = useTranslation()
  if (!evidence.length) return null
  const link = (item: Evidence, index: number) => {
    const name = t('caseDetail.sourceNumber', { number: index + 1, document: documentNames[item.document_id] ?? t('unavailable') })
    return <Button variant="subtle" size="compact-sm" px={6} aria-label={name} title={name} onClick={(event) => openSource(select(index), event.currentTarget)}>
      {t('caseDetail.sourceShort', { number: index + 1 })}
    </Button>
  }
  if (!quotes) return <Group gap={4} aria-label={t('caseDetail.sources')}>{evidence.map((item, index) => <span key={`${item.document_id}-${index}`}>{link(item, index)}</span>)}</Group>
  return <Stack gap="xs" aria-label={t('caseDetail.sources')}>
    {evidence.map((item, index) => <div key={`${item.document_id}-${index}`}>
      {link(item, index)}
      <Text component="blockquote" size="sm" m={0} pl="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', borderLeft: '2px solid var(--mantine-color-gray-4)' }}>{item.quote}</Text>
    </div>)}
  </Stack>
}

export function StatusBadge({ status }: { status: SourcedValue['status'] }) {
  const { t } = useTranslation()
  const value = status ?? 'missing'
  return <Badge size="sm" variant="light" c="dark.9" color={value === 'conflict' ? 'red' : value === 'missing' ? 'orange' : 'gray'}>{t(`caseDetail.${value}`)}</Badge>
}

export default function ClinicalValue({ label, path, value, names, documentNames, openSource, formatted }: {
  label: string; path: string; value?: SourcedValue; names: Record<string, string>; documentNames: Record<string, string>; openSource: OpenSource; formatted?: string;
}) {
  const { t } = useTranslation()
  const status = value?.status ?? 'missing'
  // A found empty value ('' or []) is shown explicitly, never as a blank (UX-3).
  const shown = value?.value != null ? formatted ?? displayValue(value.value) : null
  return <Box id={`field-${path}`} py="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)', scrollMarginTop: 80 }}>
    <Grid gap="xs">
      <Grid.Col span={{ base: 12, sm: 4 }}>
        <Text fw={600} size="sm">{label}</Text>
        <Group gap={4} mt={4}><StatusBadge status={status} />{value && <Provenance value={value} names={names} />}</Group>
      </Grid.Col>
      <Grid.Col span={{ base: 12, sm: 8 }}><Stack gap={4}>
        <Text size="sm" c={shown ? undefined : 'dimmed'} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shown === null ? '—' : shown || t('caseDetail.emptyValue')}</Text>
        {value?.note && <Alert color={status === 'conflict' ? 'red' : 'gray'} p="xs"><Text size="sm">{value.note}</Text></Alert>}
        <EvidenceLinks evidence={value?.evidence} select={(index) => ({ kind: 'field', path, index })} openSource={openSource} documentNames={documentNames} quotes={status === 'conflict'} />
        {status !== 'found' && <Group gap="xs"><Button size="compact-sm" disabled>{t('caseDetail.fill')}</Button><Button size="compact-sm" variant="outline" disabled>{t('caseDetail.request')}</Button></Group>}
      </Stack></Grid.Col>
    </Grid>
  </Box>
}
