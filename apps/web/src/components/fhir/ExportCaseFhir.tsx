import { IconFileExport } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../api'
import { getCaseFhirOptions } from '../../client/@tanstack/react-query.gen'
import DownloadFile from '../documents/DownloadFile'

function CaseFhirDownload({ caseId, actorId }: { caseId: string; actorId: string }) {
  const { t } = useTranslation()
  const query = useQuery({ ...getCaseFhirOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId), parseAs: 'blob' }), enabled: false, gcTime: 0, meta: { notify: false } })
  const errorMessage = (error: unknown) => {
    const status = error instanceof ApiError ? error.status : undefined
    return t(`fhirExport.${status === 403 ? 'forbidden' : status === 404 ? 'missing' : status === 503 ? 'unavailable' : status === 502 ? 'upstream' : 'error'}`)
  }
  return <DownloadFile label={t('fhirExport.label')} readyMessage={t('fhirExport.ready')} errorMessage={errorMessage} pending={query.isFetching}
    variant="outline" size="xs" leftSection={<IconFileExport size={16} aria-hidden />} fitButton
    filename={`case-${caseId}.fhir.json`} load={async () => {
      const result = await query.refetch()
      if (result.isError) throw result.error
      return result.data
    }} />
}

export default function ExportCaseFhir(props: { caseId: string; actorId: string }) {
  return <CaseFhirDownload key={`${props.actorId}-${props.caseId}`} {...props} />
}
