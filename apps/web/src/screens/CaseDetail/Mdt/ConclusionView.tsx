import { Badge, DataList, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { IconFileUpload, IconPencil, IconSparkles } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { MdtConclusion } from '../../../client/types.gen'
import { CopySection } from '../../../components/handover/ClinicalValue'
import { formatDate } from '../../../time'

export default function ConclusionView({ conclusion }: { conclusion: MdtConclusion }) {
  const { t, i18n } = useTranslation()
  const uploaded = conclusion.source === 'uploaded'
  const facts = [['presentedBy', conclusion.presented_by], ['diagnosis', conclusion.diagnosis_name], ['definitiveCode', conclusion.diagnosis_code], ['date', conclusion.date ? formatDate(conclusion.date, i18n.language) : null],
    ['place', conclusion.place], ['chair', conclusion.chair], ['copyTo', conclusion.copy_to?.join('\n')]] as const
  const recommendations = conclusion.recommendations?.join('\n')
  return <Stack gap="md">
    <Group gap="xs">
      <Badge variant="light" color="gray" c="dark.9" leftSection={uploaded ? <IconFileUpload size={14} aria-hidden /> : <IconPencil size={14} aria-hidden />}>{t(uploaded ? 'mdt.uploaded' : 'mdt.written')}</Badge>
      {conclusion.ai_draft_used && <Badge variant="light" color="violet" c="violet.9" leftSection={<IconSparkles size={14} aria-hidden />}>{t('mdt.draftUsed')}</Badge>}
    </Group>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">6. {t('mdt.conclusion')}</Title>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{conclusion.conclusion || t('unavailable')}</Text>
      <Group><CopySection text={() => conclusion.conclusion ?? t('unavailable')} /></Group>
    </Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">7. {t('mdt.recommendations')}</Title>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{recommendations || t('unavailable')}</Text>
      <Group><CopySection text={() => recommendations || t('unavailable')} /></Group>
    </Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">{t('mdt.assessment')}</Title>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{conclusion.clinical_assessment || t('unavailable')}</Text>
    </Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">{t('mdt.details')}</Title><DataList>
      {facts.map(([label, value]) => <DataList.Item key={label}><DataList.ItemLabel>{t(`mdt.${label}`)}</DataList.ItemLabel><DataList.ItemValue style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value || t('unavailable')}</DataList.ItemValue></DataList.Item>)}
    </DataList></Stack></Paper>
  </Stack>
}
