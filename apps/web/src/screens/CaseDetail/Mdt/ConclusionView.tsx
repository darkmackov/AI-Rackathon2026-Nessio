import { Badge, Paper, Stack, Text, Title } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { MdtConclusion } from '../../../client/types.gen'
import { CopySection, StampView } from '../../../components/handover/ClinicalValue'
import { formatDate } from '../../../time'

export default function ConclusionView({ conclusion }: { conclusion: MdtConclusion }) {
  const { t, i18n } = useTranslation()
  return <Stack gap="sm">
    <Badge variant="light">{t(conclusion.source === 'uploaded' ? 'mdt.uploaded' : 'mdt.written')}</Badge>
    {conclusion.ai_draft_used && <Text size="sm">{t('mdt.draftUsed')}</Text>}
    {(['presentedBy', 'diagnosis', 'definitiveCode', 'assessment', 'place', 'chair', 'copyTo'] as const).map((label, index) => {
      const values = [conclusion.presented_by, conclusion.diagnosis_name, conclusion.diagnosis_code, conclusion.clinical_assessment, conclusion.place, conclusion.chair, conclusion.copy_to?.join('\n')]
      return <Text key={label} size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><Text component="span" inherit fw={600}>{t(`mdt.${label}`)}: </Text>{values[index] || t('unavailable')}</Text>
    })}
    <Text size="sm">{t('mdt.date')}: {conclusion.date ? formatDate(conclusion.date, i18n.language) : t('unavailable')}</Text>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">6. {t('mdt.conclusion')}</Title><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{conclusion.conclusion || t('unavailable')}</Text><CopySection text={() => conclusion.conclusion ?? t('unavailable')} /></Stack></Paper>
    <Paper withBorder p="sm"><Stack gap="xs"><Title order={3} size="h5">7. {t('mdt.recommendations')}</Title><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{conclusion.recommendations?.join('\n') || t('unavailable')}</Text><CopySection text={() => conclusion.recommendations?.join('\n') || t('unavailable')} /></Stack></Paper>
    <Text size="sm" fw={600}>{t('mdt.confirmation')}</Text><StampView stamp={conclusion.confirmed} />
  </Stack>
}
