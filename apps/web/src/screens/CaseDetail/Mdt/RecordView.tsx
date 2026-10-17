import { Alert, Badge, DataList, Group, List, Paper, SimpleGrid, Stack, Text, ThemeIcon, Timeline, Title } from '@mantine/core'
import { IconHelpCircle, IconLock } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { MdtRecord } from '../../../client/types.gen'
import { EmptyState } from '../../../components/DataState'
import { PersonLabel } from '../../../components/PersonChip'
import { CopySection, StampView } from '../../../components/handover/ClinicalValue'
import { formatDate } from '../../../time'
import RecordBlock from './RecordBlock'

const wrap = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

export default function RecordView({ record }: { record: MdtRecord }) {
  const { t, i18n } = useTranslation()
  const facts = [['patient', record.patient_name], ['insurer', record.insurance_code], ['phone', record.patient_phone], ['email', record.patient_email], ['address', record.patient_address], ['weight', record.weight_kg], ['height', record.height_cm], ['referrer', record.referring_doctor_name], ['referrerPhone', record.referring_doctor_phone], ['referrerEmail', record.referring_doctor_email]] as const
  const results = record.results ?? [], comorbidities = record.comorbidities ?? []
  return <Stack gap="md">
    <Alert role="note" color="blue" icon={<IconLock size={18} aria-hidden />}><Stack gap={6}><Text size="sm">{t('mdt.frozen', { date: formatDate(record.mdt_date, i18n.language) })}</Text><Group gap="xs"><Text size="sm" c="dimmed">{t('mdt.preparedBy')}</Text><StampView stamp={record.created} /></Group></Stack></Alert>
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
      <RecordBlock number={1} title={t('mdt.basics')}><DataList>
        {facts.map(([label, value]) => <DataList.Item key={label}><DataList.ItemLabel>{t(`mdt.${label}`)}</DataList.ItemLabel><DataList.ItemValue>{value == null || value === '' ? t('unavailable') : String(value)}</DataList.ItemValue></DataList.Item>)}
      </DataList></RecordBlock>
      <RecordBlock number={2} title={t('mdt.members')}>
        {!record.members.length ? <EmptyState title={t('unavailable')} /> : <SimpleGrid component="ul" cols={{ base: 1, sm: 2 }} spacing="sm" verticalSpacing="sm" m={0} p={0} style={{ listStyle: 'none' }}>
          {record.members.map((member, index) => <li key={index}><PersonLabel name={member.name} secondary={member.specialty} /></li>)}
        </SimpleGrid>}
      </RecordBlock>
      <RecordBlock number={3} title={t('mdt.diagnosis')}>
        <Group gap="sm" wrap="wrap" align="center">
          <Text fw={600} style={wrap}>{record.diagnosis_name || t('unavailable')}</Text>
          {record.diagnosis_code
            ? <Badge variant="light" size="lg" ff="monospace" tt="none" aria-label={`${t('mdt.code')}: ${record.diagnosis_code}`}>{record.diagnosis_code}</Badge>
            : <Text size="sm" c="dimmed">{t('mdt.code')}: {t('unavailable')}</Text>}
        </Group>
      </RecordBlock>
      <RecordBlock number={4} title={t('mdt.comorbidities')}>
        {comorbidities.length ? <List size="sm" spacing={4}>{comorbidities.map((item, index) => <List.Item key={index}>{item}</List.Item>)}</List> : <Text size="sm">{t('unavailable')}</Text>}
      </RecordBlock>
    </SimpleGrid>
    <RecordBlock number={5} title={t('mdt.results')} aside={results.length > 0 && <CopySection text={() => results.map((row) => `${row.date} · ${row.examination}\n${row.result}`).join('\n\n')} />}>
      {!results.length ? <EmptyState title={t('unavailable')} /> : <Timeline bulletSize={14} lineWidth={2} active={results.length - 1}>
        {results.map((row, index) => <Timeline.Item key={index} title={<Text component="span" fw={600}>{row.examination}</Text>}>
          <Text size="xs" c="dimmed"><time dateTime={row.date}>{formatDate(row.date, i18n.language)}</time></Text>
          <Text size="sm" mt={4} style={wrap}>{row.result}</Text>
        </Timeline.Item>)}
      </Timeline>}
    </RecordBlock>
    <Paper component="section" aria-labelledby="mdt-request" p="md" radius="md" bg="var(--mantine-primary-color-light)"><Group gap="sm" align="flex-start" wrap="nowrap">
      <ThemeIcon size={26} radius="xl" variant="filled" aria-hidden><IconHelpCircle size={16} /></ThemeIcon>
      <Stack gap={4} miw={0}>
        <Title order={3} size="h5" id="mdt-request">{t('mdt.request')}</Title>
        <Text size="sm" style={wrap}>{record.mdt_question || t('unavailable')}</Text>
      </Stack>
    </Group></Paper>
  </Stack>
}
