import { Accordion, Anchor, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { IconArrowRight } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listFindingsOptions } from '../../client/@tanstack/react-query.gen'
import type { Finding, Handover, Severity } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import { severityMeta } from '../../components/severity-meta'
import { useSession } from '../../session'
import { handoverFields, sectionOf } from './clinical'
import { EvidenceLinks, StampView, type Sources } from './ClinicalValue'

const severities: Severity[] = ['blocker', 'warning', 'info']

function FindingItem({ finding, names, fieldLink, sources }: { finding: Finding; names: Record<string, string>; fieldLink: (path: string) => ReactNode; sources: Sources }) {
  const { t } = useTranslation()
  const links = finding.fields?.map(fieldLink).filter(Boolean) ?? []
  return <Paper withBorder p="sm" id={`finding-${finding.id}`}>
    <Stack gap={6}>
      <Text size="sm" fw={500}>{finding.message_cs}</Text>
      <Group gap="sm" wrap="wrap">
        <Text size="xs" c="dimmed">{t(`caseDetail.findingKinds.${finding.kind}`)}</Text>
        {finding.advisory && <Text size="xs" c="dimmed">{t('caseDetail.advisory')}</Text>}
        {finding.severity === 'blocker' && finding.overridable && <Text size="xs" c="dimmed">{t('caseDetail.overridable')}</Text>}
      </Group>
      {links.length > 0 && <Group gap="xs" wrap="wrap"><Text size="xs" c="dimmed">{t('caseDetail.concerns')}</Text>{links}</Group>}
      <EvidenceLinks evidence={finding.evidence} select={(index) => ({ kind: 'finding', id: finding.id, index })} sources={sources} />
      {finding.resolution && <Stack gap={2}>
        <Text size="sm">{t('caseDetail.resolution')}: {t(`caseDetail.resolutions.${finding.resolution.kind}`)}</Text>
        {finding.resolution.note && <Text size="sm" c="dimmed">{finding.resolution.note}</Text>}
        <StampView stamp={finding.resolution} names={names} size="xs" />
      </Stack>}
      {!finding.resolved && finding.suggested_action && <Group gap="xs">
        {finding.suggested_action === 'request' && <Button disabled size="compact-sm">{t('caseDetail.request')}</Button>}
        {finding.suggested_action === 'fill_in' && <Button disabled size="compact-sm">{t('caseDetail.fill')}</Button>}
        {finding.suggested_action === 'review' && <Text size="sm" c="dimmed">{t('caseDetail.review')}</Text>}
      </Group>}
    </Stack>
  </Paper>
}

export default function FindingsPanel({ caseId, names, sources, handover, showField }: {
  caseId: string; names: Record<string, string>; sources: Sources; handover?: Handover; showField: (path: string) => void;
}) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const findings = useQuery(listFindingsOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }))
  const fields = handover ? handoverFields(handover) : {}
  const all = findings.data ?? []
  const resolved = all.filter((finding) => finding.resolved)
  const fieldLabel = (path: string) => sectionOf(path)?.fields.find(([field]) => field === path)?.[1]
  const fieldLink = (path: string) => {
    const label = fieldLabel(path)
    if (!fields[path] || !label) return null
    return <Anchor key={path} href={`#field-${path}`} size="sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      onClick={(event) => { event.preventDefault(); showField(path) }}><IconArrowRight size={14} aria-hidden />{t(`caseDetail.${label}`)}</Anchor>
  }
  const item = (finding: Finding) => <FindingItem key={finding.id} finding={finding} names={names} fieldLink={fieldLink} sources={sources} />
  return <Stack component="section" aria-labelledby="findings-heading" gap="md">
    <Title order={2} size="h4" id="findings-heading">{t('caseDetail.findings')}</Title>
    {findings.isPending && <LoadingState rows={4} />}
    {findings.isError && <QueryError error={findings.error} pending={findings.isFetching} retry={() => { void findings.refetch() }} />}
    {findings.isSuccess && !all.length && <EmptyState title={t('caseDetail.noFindings')} />}
    {severities.map((severity) => {
      const group = all.filter((finding) => !finding.resolved && finding.severity === severity)
      if (!group.length) return null
      const { color, icon: SeverityIcon } = severityMeta[severity]
      return <Stack key={severity} component="section" aria-labelledby={`findings-${severity}`} gap="xs">
        <Group gap="xs">
          <SeverityIcon size={18} color={`var(--mantine-color-${color}-8)`} aria-hidden />
          <Title order={3} size="h5" id={`findings-${severity}`}>{t(`caseDetail.severity.${severity}`)}</Title>
          <Badge size="sm" variant="light" color={color} c="dark.9">{group.length}</Badge>
        </Group>
        {group.map(item)}
      </Stack>
    })}
    {resolved.length > 0 && <Accordion variant="contained" chevronPosition="left">
      <Accordion.Item value="resolved">
        <Accordion.Control>{t('caseDetail.resolvedGroup', { count: resolved.length })}</Accordion.Control>
        <Accordion.Panel><Stack gap="sm">{resolved.map(item)}</Stack></Accordion.Panel>
      </Accordion.Item>
    </Accordion>}
  </Stack>
}