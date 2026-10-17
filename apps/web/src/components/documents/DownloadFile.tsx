import { Button, type ButtonProps, Stack, Text } from '@mantine/core'
import { type ReactNode, useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Download a binary returned by a generated Query helper; revoke its URL on replacement or unmount.
 * `fitButton` wraps the feedback to the button's width so neighbouring controls don't move.
 */
export default function DownloadFile({ load, pending, filename, label, readyMessage, errorMessage, variant = 'subtle', size = 'compact-sm', leftSection, fitButton = false }: {
  load: () => Promise<unknown>; pending: boolean; filename: string; label: string; readyMessage?: string; errorMessage?: string
  variant?: ButtonProps['variant']; size?: ButtonProps['size']; leftSection?: ReactNode; fitButton?: boolean
}) {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState<'downloaded' | 'downloadError' | null>(null)
  const link = useRef<HTMLAnchorElement | null>(null), url = useRef<string | null>(null)
  const linkRef = useCallback((node: HTMLAnchorElement | null) => {
    link.current = node
    return () => { link.current = null; if (url.current) URL.revokeObjectURL(url.current); url.current = null }
  }, [])
  return <Stack gap={4} w={fitButton ? 'min-content' : undefined}><Button variant={variant} size={size} leftSection={leftSection} loading={pending} onClick={async () => {
    setFeedback(null)
    try {
      const data = await load()
      if (!link.current) return
      if (!(data instanceof Blob)) throw new Error('Expected a binary file')
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = URL.createObjectURL(data); link.current.href = url.current; link.current.click(); setFeedback('downloaded')
    } catch { if (link.current) setFeedback('downloadError') }
  }}>{label}</Button><a hidden ref={linkRef} download={filename} />
    {feedback && <Text size="sm" role={feedback === 'downloadError' ? 'alert' : 'status'} c={feedback === 'downloadError' ? 'red.9' : undefined}>{(feedback === 'downloadError' ? errorMessage : readyMessage) ?? t(`caseDetail.${feedback}`)}</Text>}
  </Stack>
}
