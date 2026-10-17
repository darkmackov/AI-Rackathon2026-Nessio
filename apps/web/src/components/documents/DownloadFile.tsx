import Button from '../ActionButton'
import { Stack, Text } from '@mantine/core'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api-error'
import { notifyApiError, notifyError, notifySuccess } from '../../notifications/notify'

/** Download a binary returned by a generated Query helper; revoke its URL on replacement or unmount. */
export default function DownloadFile({ load, pending, filename, label, readyMessage, errorMessage }: { load: () => Promise<unknown>; pending: boolean; filename: string; label: string; readyMessage?: string; errorMessage?: string }) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<'downloaded' | null>(null)
  const link = useRef<HTMLAnchorElement | null>(null), url = useRef<string | null>(null)
  const linkRef = useCallback((node: HTMLAnchorElement | null) => {
    link.current = node
    return () => { link.current = null; if (url.current) URL.revokeObjectURL(url.current); url.current = null }
  }, [])
  return <Stack gap={4}><Button variant="subtle" size="compact-sm" pending={pending} onClick={async () => {
    setFeedback(null)
    try {
      const data = await load()
      if (!link.current) return
      if (!(data instanceof Blob)) throw new Error('Expected a binary file')
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = URL.createObjectURL(data); link.current.href = url.current; link.current.click(); setFeedback('downloaded')
      notifySuccess('download', readyMessage ?? t('caseDetail.downloaded'))
    } catch (error) {
      if (link.current) {
        if (error instanceof ApiError) notifyApiError(error)
        else notifyError('download', errorMessage ?? t('caseDetail.downloadError'))
      }
    }
  }}>{label}</Button><a hidden ref={linkRef} download={filename} />
    {feedback && <Text size="sm" role="status">{readyMessage ?? t('caseDetail.downloaded')}</Text>}
  </Stack>
}
