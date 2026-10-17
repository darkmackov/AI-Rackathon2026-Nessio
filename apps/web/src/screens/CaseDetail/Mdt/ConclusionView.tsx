import { Badge, DataList, Group, List, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconFileUpload, IconListDetails, IconPencil, IconSparkles, IconStethoscope } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { MdtConclusion } from '../../../client/types.gen'
import { CopySection } from '../../../components/handover/ClinicalValue'
import { formatDate } from '../../../time'
import RecordBlock from './RecordBlock'

const wrap = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const

export default function ConclusionView({ conclusion }: { conclusion: MdtConclusion }) {
  const { t, i18n } = useTranslation()
  const uploaded = conclusion.source === 'uploaded'
  const facts = [['presentedBy', conclusion.presented_by], ['diagnosis', conclusion.diagnosis_name], ['definitiveCode', conclusion.diagnosis_code], ['date', conclusion.date ? formatDate(conclusion.date, i18n.language) : null],
    ['place', conclusion.place], ['chair', conclusion.chair], ['copyTo', conclusion.copy_to?.join('\n')]] as const
  const recommendations = conclusion.recommendations ?? []
  return <Stack gap="md">
    <RecordBlock number={6} primary title={t('mdt.conclusion')} aside={<Group gap="xs">
      <Badge variant="light" color="gray" c="dark.9" leftSection={uploaded ? <IconFileUpload size={14} aria-hidden /> : <IconPencil size={14} aria-hidden />}>{t(uploaded ? 'mdt.uploaded' : 'mdt.written')}</Badge>
      {conclusion.ai_draft_used && <Badge variant="light" color="violet" c="violet.9" leftSection={<IconSparkles size={14} aria-hidden />}>{t('mdt.draftUsed')}</Badge>}
    </Group>}>
      <Text style={wrap}>{conclusion.conclusion || t('unavailable')}</Text>
      <Group><CopySection text={() => conclusion.conclusion ?? t('unavailable')} /></Group>
    </RecordBlock>
    <RecordBlock number={7} primary title={t('mdt.recommendations')}>
      {recommendations.length
        ? <List type="ordered" spacing={4}>{recommendations.map((item, index) => <List.Item key={index} style={wrap}>{item}</List.Item>)}</List>
        : <Text>{t('unavailable')}</Text>}
      <Group><CopySection text={() => recommendations.join('\n') || t('unavailable')} /></Group>
    </RecordBlock>
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
      <RecordBlock icon={<IconStethoscope size={16} />} title={t('mdt.assessment')}>
        <Text size="sm" style={wrap}>{conclusion.clinical_assessment || t('unavailable')}</Text>
      </RecordBlock>
      <RecordBlock icon={<IconListDetails size={16} />} title={t('mdt.details')}><DataList>
        {facts.map(([label, value]) => <DataList.Item key={label}><DataList.ItemLabel>{t(`mdt.${label}`)}</DataList.ItemLabel><DataList.ItemValue style={wrap}>{value || t('unavailable')}</DataList.ItemValue></DataList.Item>)}
      </DataList></RecordBlock>
    </SimpleGrid>
  </Stack>
}
