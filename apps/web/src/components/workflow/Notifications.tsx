import { Anchor, Badge, Button, Drawer, Group, Paper, Stack, Text } from '@mantine/core'
import { IconBell } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listNotificationsOptions } from '../../client/@tanstack/react-query.gen'
import LoadingState, { EmptyState, QueryError } from '../DataState'
import { useSession } from '../../session'
import { formatDateTime } from '../../time'

export default function Notifications() {
  const { t } = useTranslation(), [opened, setOpened] = useState(false)
  return <>
    <Button size="sm" variant="subtle" leftSection={<IconBell size={16} aria-hidden />} onClick={() => setOpened(true)}>{t('workflow.notifications')}</Button>
    <Drawer opened={opened} onClose={() => setOpened(false)} position="right" title={t('workflow.notifications')} closeButtonProps={{ 'aria-label': t('close') }}>
      {opened && <NotificationList onClose={() => setOpened(false)} />}
    </Drawer>
  </>
}

function NotificationList({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(), { actorId } = useSession()
  const notices = useQuery({ ...listNotificationsOptions({ headers: actorHeaders(actorId ?? '') }), refetchInterval: 1000, gcTime: 0 })
  return <Stack gap="sm"><Text size="sm" c="dimmed">{t('workflow.notificationsHelp')}</Text>
        {notices.isPending && <LoadingState rows={3} />}
        {notices.isError && <QueryError error={notices.error} retry={() => { void notices.refetch() }} />}
        {notices.isSuccess && !notices.data.length && <EmptyState title={t('workflow.noNotifications')} />}
        {notices.data?.map((notice) => <Paper withBorder p="sm" key={notice.task_id}><Stack gap={4}>
          <Anchor renderRoot={(props) => <Link {...props} to="/coordinator/cases/$caseId" params={{ caseId: notice.case_id }} search={{ tab: 'tasks' }} hash={`task-${notice.task_id}`} onClick={onClose} />} size="sm" fw={600}>{notice.title}</Anchor>
          <Group gap="xs"><Text size="sm"><time dateTime={notice.due}>{formatDateTime(notice.due, i18n.language)}</time></Text>{notice.overdue && <Badge color="red" variant="light">{t('caseDetail.overdue')}</Badge>}</Group>
        </Stack></Paper>)}
      </Stack>
}
