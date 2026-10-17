import { Badge, VisuallyHidden, type MantineSize } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { Priority } from '../client/types.gen'
import { priorityColor } from './priority-meta'

export function PriorityBadge({ priority, size = 'md' }: { priority?: Priority | null; size?: MantineSize }) {
  const { t } = useTranslation()
  return <Badge size={size} variant="outline" color={priority ? priorityColor[priority] : 'gray'} c="dark.9"><VisuallyHidden>{t('priority')}: </VisuallyHidden>{priority ? t(`priorities.${priority}`) : t('unavailable')}</Badge>
}
