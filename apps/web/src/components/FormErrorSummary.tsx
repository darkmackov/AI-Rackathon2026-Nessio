import { Alert, List } from '@mantine/core'
import { useTranslation } from 'react-i18next'

const focusSummary = (node: HTMLDivElement | null) => { node?.focus() }

export default function FormErrorSummary({ errors }: { errors: string[] }) {
  const { t } = useTranslation()
  if (!errors.length) return null
  return <Alert color="red" title={t('validationTitle')} role="alert" tabIndex={-1}
    ref={focusSummary}>
    <List size="sm">{errors.map((error) => <List.Item key={error}>{error}</List.Item>)}</List>
  </Alert>
}
