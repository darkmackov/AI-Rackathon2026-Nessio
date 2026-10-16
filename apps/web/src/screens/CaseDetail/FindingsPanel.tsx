import { Accordion, Anchor, Badge, Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listFindingsOptions } from '../../client/@tanstack/react-query.gen'
import type { Finding, Handover } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import { useSession } from '../../session'
import { handoverFields, sectionOf } from './clinical'
import { EvidenceLinks, StampView, type OpenSource } from './ClinicalValue'

export default function FindingsPanel({ caseId, names, documentNames, handover, openSource, showField }: {
  caseId: string; names: Record<string, string>; documentNames: Record<string, string>; handover?: Handover; openSource: OpenSource; showField: (path: string) => void;
}) {
  const { t } = useTranslation()
  const { actorId } = useSession()
  const findings = useQuery(listFindingsOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }))
  const fields = handover ? handoverFields(handover) : {}
  const rank = { blocker: 0, warning: 1, info: 2 }
  const sorted = [...findings.data ?? []].sort((a, b) => rank[a.severity] - rank[b.severity])
  const open = sorted.filter((finding) => !finding.resolved)
  const resolved = sorted.filter((finding) => finding.resolved)
  const fieldLabel = (path: string) => sectionOf(path)?.fields.find(([field]) => field === path)?.[1]
  const card = (finding: Finding) => <Paper withBorder p="sm" key={finding.id} id={`finding-${finding.id}`} style={{ scrollMarginTop: 80 }}>
    <Stack gap={6}>
      <Group gap="xs">
        <Badge variant="light" c="dark.9" color={finding.severity === 'blocker' ? 'red' : finding.severity === 'warning' ? 'orange' : 'blue'}>{t(`s1.severity.${finding.severity}`)}</Badge>
        <Badge color="gray" variant="outline">{t(`s1.findingKinds.${finding.kind}`)}</Badge>
        {finding.advisory && <Badge color="gray" variant="light" c="dark.9">{t('s1.advisory')}</Badge>}
        <Text size="xs" c="dimmed">{finding.id}</Text>
      </Group>
      <Text size="sm">{finding.message_cs}</Text>
      {finding.severity === 'blocker' && finding.overridable && <Text size="xs" c="dimmed">{t('s1.overridable')}</Text>}
      <Group gap="xs" wrap="wrap">
        {finding.fields?.filter((path) => fields[path] && fieldLabel(path)).map((path) => <Anchor key={path} href={`#field-${path}`} size="sm"
          onClick={(event) => { event.preventDefault(); showField(path) }}>→ {t(`s1.${fieldLabel(path)}`)}</Anchor>)}
        <EvidenceLinks evidence={finding.evidence} select={(index) => ({ kind: 'finding', id: finding.id, index })} openSource={openSource} documentNames={documentNames} />
      </Group>
      {finding.resolution && <Text size="sm">{t('s1.resolution')}: {t(`s1.resolutions.${finding.resolution.kind}`)}{finding.resolution.note ? ` · ${finding.resolution.note}` : ''}</Text>}
      {finding.resolution && <StampView stamp={finding.resolution} names={names} size="xs" />}
      {!finding.resolved && finding.suggested_action && <Group gap="xs">
        {finding.suggested_action === 'request' && <Button disabled size="compact-sm">{t('s1.request')}</Button>}
        {finding.suggested_action === 'fill_in' && <Button disabled size="compact-sm">{t('s1.fill')}</Button>}
        {finding.suggested_action === 'review' && <Text size="sm" c="dimmed">{t('s1.review')}</Text>}
      </Group>}
    </Stack>
  </Paper>
  return <Stack component="section" aria-labelledby="findings-heading" gap="sm">
    <Title order={2} size="h4" id="findings-heading">{t('s1.findings')}</Title>
    {findings.isPending && <LoadingState />}
    {findings.isError && <QueryError error={findings.error} pending={findings.isFetching} retry={() => { void findings.refetch() }} />}
    {findings.isSuccess && !sorted.length && <EmptyState title={t('s1.noFindings')} />}
    {open.map(card)}
    {resolved.length > 0 && <Accordion variant="contained" chevronPosition="left">
      <Accordion.Item value="resolved">
        <Accordion.Control>{t('s1.resolvedGroup', { count: resolved.length })}</Accordion.Control>
        <Accordion.Panel><Stack gap="sm">{resolved.map(card)}</Stack></Accordion.Panel>
      </Accordion.Item>
    </Accordion>}
  </Stack>
}
