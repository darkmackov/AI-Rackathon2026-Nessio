import { Anchor, Badge, Button, Group, Paper, Stack, Text, VisuallyHidden } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Link } from '@tanstack/react-router'
import { IconArrowBackUp, IconArrowLeft, IconCircleCheck, IconPlayerPause, IconUserCheck, type Icon } from '@tabler/icons-react'
import { useCallback, useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DetailTab } from '../../case-route'
import type { Case, Finding, Handover } from '../../client/types.gen'
import { DueDate } from '../../components/CaseTime'
import PageHeading from '../../components/PageHeading'
import PersonChip from '../../components/PersonChip'
import { severityMeta } from '../../components/severity-meta'
import { fieldStatusCounts } from './clinical'
import { statusMeta } from './status-meta'

const priorityColor = { normal: 'gray', high: 'orange', urgent: 'red' } as const

export function BackLink() {
  const { t } = useTranslation()
  return <Anchor component={Link} to="/coordinator" size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
    <IconArrowLeft size={16} aria-hidden />{t('caseDetail.back')}
  </Anchor>
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <Group gap={6} wrap="nowrap" miw={0}><Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{label}</Text>{children}</Group>
}

function AttentionStrip({ caseId, findings, handover }: { caseId: string; findings?: Finding[]; handover?: Handover }) {
  const { t } = useTranslation()
  const label = useId()
  if (!findings || !handover) return null
  const open = findings.filter((finding) => !finding.resolved)
  const fields = fieldStatusCounts(handover)
  const all: { key: string; count: number; tab: DetailTab; color: string; icon: Icon }[] = [
    { key: 'blockers', count: open.filter((finding) => finding.severity === 'blocker').length, tab: 'findings', ...severityMeta.blocker },
    { key: 'warnings', count: open.filter((finding) => finding.severity === 'warning').length, tab: 'findings', ...severityMeta.warning },
    { key: 'missingFields', count: fields.missing, tab: 'handover', ...statusMeta.missing },
    { key: 'conflictFields', count: fields.conflict, tab: 'handover', ...statusMeta.conflict },
  ]
  const items = all.filter((item) => item.count > 0)
  return <Group gap="xs" wrap="wrap" role="group" aria-labelledby={label}>
    <Text size="xs" c="dimmed" id={label}>{t('caseDetail.attention')}</Text>
    {!items.length && <Group gap={4}><IconCircleCheck size={16} color="var(--mantine-color-green-8)" aria-hidden /><Text size="sm">{t('caseDetail.nothingToResolve')}</Text></Group>}
    {items.map(({ key, count, tab, color, icon: ItemIcon }) => <Button key={key} variant="light" color={color} c="dark.9" size="compact-sm"
      leftSection={<ItemIcon size={16} color={`var(--mantine-color-${color}-8)`} aria-hidden />}
      renderRoot={(props) => <Link {...props} to="/coordinator/cases/$caseId" params={{ caseId }} search={{ tab }} />}>
      {t(`caseDetail.${key}`, { count })}
    </Button>)}
  </Group>
}

/** The sticky case header: where the case is, who is on the move and by when (UX-4), plus what needs attention. */
export default function CaseHeader({ item, findings, handover }: { item: Case; findings?: Finding[]; handover?: Handover }) {
  const { t } = useTranslation()
  const heading = useId()
  // Sticky only where there is room for it; at 320 px or 200 % zoom it would cover the content (A11Y-10).
  const sticky = useMediaQuery('(min-width: 48em)') ?? false
  // Publishes the header height so focused elements, anchors and the source panel stay clear of it (A11Y-2).
  const measure = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--case-header-height', sticky ? `${node.offsetHeight}px` : '0px')
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => { observer.disconnect(); root.style.removeProperty('--case-header-height') }
  }, [sticky])
  return <Paper ref={measure} component="section" aria-labelledby={heading} withBorder shadow={sticky ? 'xs' : undefined} p="sm" pos={sticky ? 'sticky' : 'static'} top={0} style={{ zIndex: 100 }}>
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end" gap="sm">
        <Stack gap={2} miw={0}>
          <BackLink />
          <PageHeading size="h2" id={heading}>{item.patient_name}</PageHeading>
          <Text size="sm" c="dimmed">{item.diagnosis_label ?? t('unavailable')}</Text>
        </Stack>
        <Group gap="xs">
          <Button size="xs" leftSection={<IconUserCheck size={16} aria-hidden />} disabled>{t('caseDetail.takeOver')}</Button>
          <Button size="xs" variant="outline" leftSection={<IconArrowBackUp size={16} aria-hidden />} disabled>{t('caseDetail.returnCase')}</Button>
          <Button size="xs" variant="outline" leftSection={<IconPlayerPause size={16} aria-hidden />} disabled>{t('caseDetail.hold')}</Button>
        </Group>
      </Group>
      <Group gap="md" wrap="wrap" style={{ rowGap: 'var(--mantine-spacing-xs)' }}>
        <Group gap={6}>
          <Badge variant="light"><VisuallyHidden>{t('state')}: </VisuallyHidden>{item.state ? t(`states.${item.state}`) : t('unavailable')}</Badge>
          <Badge variant="outline" color={item.priority ? priorityColor[item.priority] : 'gray'} c="dark.9"><VisuallyHidden>{t('priority')}: </VisuallyHidden>{item.priority ? t(`priorities.${item.priority}`) : t('unavailable')}</Badge>
          {item.on_hold && <Badge variant="light" color="gray" c="dark.9" leftSection={<IconPlayerPause size={12} aria-hidden />}>{t('caseDetail.onHold')}</Badge>}
        </Group>
        <Fact label={t('owner')}><PersonChip id={item.on_move} size="xs" /></Fact>
        <Fact label={t('nextStep')}><Text size="sm" fw={500}>{item.next_step ?? t('unavailable')}</Text></Fact>
        <Fact label={t('nextDue')}><DueDate value={item.next_due} /></Fact>
      </Group>
      <AttentionStrip caseId={item.id} findings={findings} handover={handover} />
    </Stack>
  </Paper>
}
