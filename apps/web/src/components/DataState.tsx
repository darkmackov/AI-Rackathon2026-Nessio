import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api'

function errorKey(error: unknown) {
  if (!(error instanceof ApiError)) return 'errorOther'
  if (error.status === undefined) return 'errorNetwork'
  switch (error.status) {
    case 400: return 'error400'
    case 403: return 'error403'
    case 404: return 'error404'
    case 409: return 'error409'
    case 422: return 'error422'
    case 501: return 'error501'
    default: return 'errorOther'
  }
}

export function QueryError({ error, retry, pending = false }: { error: unknown; retry?: () => void; pending?: boolean }) {
  const { t } = useTranslation()
  return <Alert color="red" title={t('errorTitle')} role="alert">
    <Stack gap="xs">
      <Text size="sm">{t(errorKey(error))}</Text>
      {retry && <Button variant="outline" color="red" size="compact-sm" onClick={retry} loading={pending}>{t('retry')}</Button>}
    </Stack>
  </Alert>
}

export function EmptyState({ title, description, retry }: { title: string; description?: string; retry?: () => void }) {
  const { t } = useTranslation()
  return <Alert color="gray" title={title} role="status">
    {description && <Text size="sm">{description}</Text>}
    {retry && <Button mt="sm" variant="outline" onClick={retry}>{t('retry')}</Button>}
  </Alert>
}

export default function LoadingState() {
  const { t } = useTranslation()
  return <Group role="status" py="md"><Loader size="sm" /><Text>{t('loading')}</Text></Group>
}
