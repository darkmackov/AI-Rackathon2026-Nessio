import Button from '../ActionButton'
import { type ButtonProps, Stack, Text } from '@mantine/core'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../../api-error'
import { hideSuccess, notifyApiError, notifyError, notifySuccess } from '../../notifications/notify'

/**
 * Download a binary returned by a generated Query helper; revoke its URL on replacement or unmount.
 * `fitButton` wraps the feedback to the button's width so neighbouring controls don't move.
 * Without `readyMessage` a successful download shows no inline message.
 * An `errorMessage` function picks the failure text from the error itself, even for an `ApiError`.
 */
export default function DownloadFile({ load, pending, filename, label, readyMessage, errorMessage, variant = 'subtle', size = 'compact-sm', leftSection, fitButton = false }: {
  load: () => Promise<unknown>; pending: boolean; filename: string; label: string; readyMessage?: string; errorMessage?: string | ((error: unknown) => string)
  variant?: ButtonProps['variant']; size?: ButtonProps['size']; leftSection?: ReactNode; fitButton?: boolean
}) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<'downloaded' | null>(null)
  const link = useRef<HTMLAnchorElement | null>(null), url = useRef<string | null>(null)
  const message = feedback === 'downloaded' ? readyMessage : undefined
  const linkRef = useCallback((node: HTMLAnchorElement | null) => {
    link.current = node
    return () => { link.current = null; if (url.current) URL.revokeObjectURL(url.current); url.current = null }
  }, [])
  return <Stack gap={4} w={fitButton ? 'min-content' : undefined}><Button variant={variant} size={size} leftSection={leftSection} pending={pending} onClick={async () => {
    setFeedback(null); hideSuccess('download')
    try {
      const data = await load()
      if (!link.current) return
      if (!(data instanceof Blob)) throw new Error('Expected a binary file')
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = URL.createObjectURL(data); link.current.href = url.current; link.current.click(); setFeedback('downloaded')
      notifySuccess('download', readyMessage ?? t('caseDetail.downloaded'))
    } catch (error) {
      if (link.current) {
        if (error instanceof ApiError && typeof errorMessage !== 'function') notifyApiError(error)
        else notifyError('download', (typeof errorMessage === 'function' ? errorMessage(error) : errorMessage) ?? t('caseDetail.downloadError'))
      }
    }
  }}>{label}</Button><a hidden ref={linkRef} download={filename} />
    {message && <Text size="sm" role="status">{message}</Text>}
  </Stack>
}
