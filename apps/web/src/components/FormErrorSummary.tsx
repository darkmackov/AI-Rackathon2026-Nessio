import { Alert, List } from '@mantine/core'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export default function FormErrorSummary({ errors, focusKey }: { errors: string[]; focusKey?: number }) {
  const { t } = useTranslation()
  const focused = useRef<{ key?: number } | null>(null)
  const focusSummary = useCallback((node: HTMLDivElement | null) => {
    if (node && focusKey !== 0 && (!focused.current || focused.current.key !== focusKey)) {
      focused.current = { key: focusKey }
      node.focus()
    }
  }, [focusKey])
  if (!errors.length) return null
  return <Alert color="red" title={t('validationTitle')} role="alert" tabIndex={-1}
    ref={focusSummary}>
    <List size="sm">{errors.map((error, index) => <List.Item key={`${index}:${error}`}>{error}</List.Item>)}</List>
  </Alert>
}
