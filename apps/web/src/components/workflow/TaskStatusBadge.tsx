import { Badge, type MantineSize } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { TaskStatus } from '../../client/types.gen'
import { taskStatusMeta } from './task-status-meta'

export function TaskStatusBadge({ status, size = 'sm' }: { status?: TaskStatus | null; size?: MantineSize }) {
  const { t } = useTranslation()
  const value = status ?? 'planned'
  const { color, icon: StatusIcon } = taskStatusMeta[value]
  return <Badge size={size} variant="light" color={color} c="dark.9" style={{ flexShrink: 0 }} leftSection={<StatusIcon size={12} aria-hidden />}>{t(`caseDetail.taskStatus.${value}`)}</Badge>
}
