import { Accordion, Badge, Box, Button, Group, Spoiler, Stack, Table, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { Handover } from '../../client/types.gen'
import { EmptyState } from '../../components/DataState'
import { formatDate } from '../../time'
import ClinicalValue, { CopySection, EvidenceLinks, Provenance, type OpenSource } from './ClinicalValue'
import { displayValue, handoverFields, handoverSections, problemCount, type HandoverSection } from './clinical'

const rowStyle = { borderTop: '1px solid var(--mantine-color-gray-3)' }

export default function HandoverTab({ handover, names, documentNames, openSource, open, setOpen }: {
  handover: Handover; names: Record<string, string>; documentNames: Record<string, string>; openSource: OpenSource; open: string[]; setOpen: (sections: string[]) => void;
}) {
  const { t, i18n } = useTranslation()
  const fields = handoverFields(handover)
  const allOpen = handoverSections.every((section) => open.includes(section.key))
  const fieldCopy = (path: string, label: string) => {
    const value = fields[path]
    return `${t(`caseDetail.${label}`)}: ${displayValue(value?.value) || t('caseDetail.missing')} [${t(`caseDetail.${value?.status ?? 'missing'}`)}; ${t(`caseDetail.${value?.origin ?? 'ai'}`)}]${value?.note ? `\n${value.note}` : ''}${value?.entered ? `\n${names[value.entered.by] ?? t('unavailable')} · ${value.entered.at}` : ''}`
  }
  const examinationText = () => (handover.examinations ?? []).map((row) => `${row.date} · ${row.place} · ${row.type}\n${row.result_full_text}\n${t(`caseDetail.${row.origin ?? 'ai'}`)}`).join('\n\n')
  const labsText = () => (handover.labs ?? []).map((row) => `${row.date} · ${row.place}\n${t(`caseDetail.${row.origin ?? 'ai'}`)}\n${row.values.map((value) => `${value.name}: ${value.value} ${value.unit ?? ''} (${value.reference_range ?? t('unavailable')}) ${value.flag ?? ''}`).join('\n')}`).join('\n\n')
  const copyText = (section: HandoverSection) => {
    const title = t(`caseDetail.${section.key}`)
    if (section.key === 'examinations') return `${title}\n${examinationText() || t('caseDetail.emptySection')}`
    if (section.key === 'labs') return `${title}\n${labsText() || t('caseDetail.emptySection')}`
    return `${title}\n${section.fields.map(([path, label]) => fieldCopy(path, label)).join('\n\n')}`
  }
  const summary = (section: HandoverSection) => {
    if (section.key === 'examinations' || section.key === 'labs') {
      const rows = (section.key === 'examinations' ? handover.examinations : handover.labs)?.length ?? 0
      return <Badge size="sm" variant="light" color="gray" c="dark.9">{t('caseDetail.records', { count: rows })}</Badge>
    }
    const problems = problemCount(fields, section)
    return problems > 0 && <Badge size="sm" variant="light" color="orange" c="dark.9">⚠ {t('caseDetail.problems', { count: problems })}</Badge>
  }
  const examinations = <>
    {!handover.examinations?.length && <EmptyState title={t('caseDetail.emptySection')} />}
    {handover.examinations?.map((row, index) => <Box key={index} py="sm" style={rowStyle}><Stack gap={6}>
      <Group justify="space-between" align="flex-start" gap="xs">
        <div><Title order={3} size="h5">{row.type}</Title><Text size="xs" c="dimmed">{formatDate(row.date, i18n.language)} · {row.place}</Text></div>
        <Provenance value={row} names={names} />
      </Group>
      <Spoiler maxHeight={96} showLabel={t('caseDetail.showMore')} hideLabel={t('caseDetail.showLess')}>
        <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.result_full_text}</Text>
      </Spoiler>
      <EvidenceLinks evidence={row.evidence} select={(sourceIndex) => ({ kind: 'examination', row: index, index: sourceIndex })} openSource={openSource} documentNames={documentNames} />
    </Stack></Box>)}
  </>
  const labs = <>
    {!handover.labs?.length && <EmptyState title={t('caseDetail.emptySection')} />}
    {handover.labs?.map((row, index) => <Box key={index} py="sm" style={rowStyle}><Stack gap={6}>
      <Group justify="space-between" align="flex-start" gap="xs">
        <Title order={3} size="h5">{formatDate(row.date, i18n.language)} · {row.place}</Title>
        <Provenance value={row} names={names} />
      </Group>
      <Table.ScrollContainer minWidth={440}><Table withRowBorders verticalSpacing={4} fz="sm"><Table.Thead><Table.Tr>{['result', 'unit', 'reference', 'flag'].map((label) => <Table.Th key={label}>{t(`caseDetail.${label}`)}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>
        {row.values.map((value, valueIndex) => <Table.Tr key={valueIndex}><Table.Td>{value.name}: {value.value}</Table.Td><Table.Td>{value.unit ?? t('unavailable')}</Table.Td><Table.Td>{value.reference_range ?? t('unavailable')}</Table.Td><Table.Td>{value.flag ?? '—'}</Table.Td></Table.Tr>)}
      </Table.Tbody></Table></Table.ScrollContainer>
      <EvidenceLinks evidence={row.evidence} select={(sourceIndex) => ({ kind: 'lab', row: index, index: sourceIndex })} openSource={openSource} documentNames={documentNames} />
    </Stack></Box>)}
  </>
  return <Stack gap="sm">
    <Group justify="flex-end">
      <Button variant="subtle" size="compact-sm" onClick={() => setOpen(allOpen ? [] : handoverSections.map((section) => section.key))}>{t(allOpen ? 'caseDetail.collapseAll' : 'caseDetail.expandAll')}</Button>
    </Group>
    <Accordion multiple value={open} onChange={setOpen} order={2} variant="separated" chevronPosition="left">
      {handoverSections.map((section) => <Accordion.Item key={section.key} value={section.key}>
        <Accordion.Control><Group gap="sm" wrap="wrap"><Text fw={650}>{t(`caseDetail.${section.key}`)}</Text>{summary(section)}</Group></Accordion.Control>
        <Accordion.Panel>
          <Group justify="flex-end" mb="xs"><CopySection text={() => copyText(section)} /></Group>
          {section.key === 'examinations' ? examinations : section.key === 'labs' ? labs : section.fields.map(([path, label]) => <ClinicalValue key={path} label={t(`caseDetail.${label}`)} path={path} value={fields[path]} names={names} documentNames={documentNames} openSource={openSource}
            formatted={path === 'patient.birth_date' && typeof fields[path]?.value === 'string' ? formatDate(String(fields[path]?.value), i18n.language) : undefined} />)}
        </Accordion.Panel>
      </Accordion.Item>)}
    </Accordion>
  </Stack>
}
