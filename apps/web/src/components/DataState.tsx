import Button from './ActionButton'
import { Alert, Group, Loader, Skeleton, Stack, Text, VisuallyHidden } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { allowNotificationRecovery } from '../notifications/notify'

export function QueryError({ retry, pending = false }: { error: unknown; retry?: () => void; pending?: boolean }) {
  const { t } = useTranslation()
  if (!retry) return null
  return <Group py="sm">
    <Button variant="outline" size="compact-sm" onClick={() => { allowNotificationRecovery(); retry() }} pending={pending}>{t('retry')}</Button>
  </Group>
}

export function EmptyState({ title, description, retry }: { title: string; description?: string; retry?: () => void }) {
  const { t } = useTranslation()
  return <Alert color="gray" title={title} role="status">
    {description && <Text size="sm">{description}</Text>}
    {retry && <Button mt="sm" variant="outline" onClick={retry}>{t('retry')}</Button>}
  </Alert>
}

/** `rows` renders a skeleton of that many rows instead of a spinner, so the layout keeps its height while loading. */
export default function LoadingState({ rows }: { rows?: number }) {
  const { t } = useTranslation()
  if (rows) return <Stack role="status" gap="sm">
    <VisuallyHidden>{t('loading')}</VisuallyHidden>
    {Array.from({ length: rows }, (_, index) => <Skeleton key={index} height={index === 0 ? 24 : 64} width={index === 0 ? '40%' : '100%'} aria-hidden />)}
  </Stack>
  return <Group role="status" py="md"><Loader size="sm" /><Text>{t('loading')}</Text></Group>
}
