import { DataList, Paper, Stack, Table, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { MdtRecord } from '../../../client/types.gen'
import { EmptyState } from '../../../components/DataState'
import { CopySection, StampView } from '../../../components/handover/ClinicalValue'
import { formatDate } from '../../../time'

export default function RecordView({ record }: { record: MdtRecord }) {
  const { t, i18n } = useTranslation()
  const facts = [['patient', record.patient_name], ['insurer', record.insurance_code], ['phone', record.patient_phone], ['email', record.patient_email], ['address', record.patient_address], ['weight', record.weight_kg], ['height', record.height_cm], ['referrer', record.referring_doctor_name], ['referrerPhone', record.referring_doctor_phone], ['referrerEmail', record.referring_doctor_email]] as const
  return <Stack gap="md">
    <Text size="sm" role="status">{t('mdt.frozen', { date: formatDate(record.mdt_date, i18n.language) })}</Text><StampView stamp={record.created} />
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">1. {t('mdt.basics')}</Title><DataList>
      {facts.map(([label, value]) => <DataList.Item key={label}><DataList.ItemLabel>{t(`mdt.${label}`)}</DataList.ItemLabel><DataList.ItemValue>{value == null || value === '' ? t('unavailable') : String(value)}</DataList.ItemValue></DataList.Item>)}
    </DataList></Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">2. {t('mdt.members')}</Title>
      {!record.members.length && <EmptyState title={t('unavailable')} />}{record.members.map((member, index) => <Text size="sm" key={index}>{member.name} · {member.specialty}</Text>)}
    </Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">3. {t('mdt.diagnosis')}</Title><Text size="sm">{record.diagnosis_name || t('unavailable')}</Text><Text size="sm">{t('mdt.code')}: {record.diagnosis_code || t('unavailable')}</Text></Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">4. {t('mdt.comorbidities')}</Title><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{record.comorbidities?.join('\n') || t('unavailable')}</Text></Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">5. {t('mdt.results')}</Title>
      <CopySection text={() => (record.results ?? []).map((row) => `${row.date} · ${row.examination}\n${row.result}`).join('\n\n')} />
      {!record.results?.length ? <EmptyState title={t('unavailable')} /> : <Table.ScrollContainer minWidth={480}><Table fz="sm" withTableBorder><Table.Thead><Table.Tr><Table.Th>{t('mdt.resultDate')}</Table.Th><Table.Th>{t('mdt.examination')}</Table.Th><Table.Th>{t('mdt.result')}</Table.Th></Table.Tr></Table.Thead><Table.Tbody>
        {record.results.map((row, index) => <Table.Tr key={index}><Table.Td>{formatDate(row.date, i18n.language)}</Table.Td><Table.Td>{row.examination}</Table.Td><Table.Td style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.result}</Table.Td></Table.Tr>)}
      </Table.Tbody></Table></Table.ScrollContainer>}
    </Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">{t('mdt.question')}</Title><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{record.mdt_question || t('unavailable')}</Text></Stack></Paper>
  </Stack>
}
