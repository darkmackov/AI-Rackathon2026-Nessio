import { Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { getMdtConclusionPdfOptions, getMdtRecordPdfOptions } from '../../../client/@tanstack/react-query.gen'
import DownloadFile from '../../../components/documents/DownloadFile'
import { apiMode } from '../../../config'

export default function PdfDownload({ caseId, actorId, kind }: { caseId: string; actorId: string; kind: 'record' | 'conclusion' }) {
  const { t } = useTranslation()
  const options = { path: { case_id: caseId }, headers: actorHeaders(actorId), parseAs: 'blob' } as const
  const query = useQuery({ ...(kind === 'record' ? getMdtRecordPdfOptions(options) : getMdtConclusionPdfOptions(options)), enabled: false, gcTime: 0 })
  return <Stack gap={4} align="flex-start"><DownloadFile label={t(kind === 'record' ? 'mdt.recordPdf' : 'mdt.conclusionPdf')} readyMessage={t('mdt.pdfReady')} errorMessage={t('mdt.pdfError')} pending={query.isFetching} filename={`MDT_${kind}.pdf`} load={async () => { const result = await query.refetch(); if (result.isError) throw result.error; return result.data }} />
    {apiMode === 'mock' && <Text size="xs" c="dimmed">{t('mdt.demoPdf')}</Text>}
  </Stack>
}
