import { IconCalendarCheck, IconCircleCheck, IconCircleDashed, IconCircleX, type Icon } from '@tabler/icons-react'
import type { TaskStatus } from '../../client/types.gen'

// One mapping for every task status: icon, label and colour together (UX-17, A11Y-4).
export const taskStatusMeta: Record<TaskStatus, { color: string; icon: Icon }> = {
  planned: { color: 'gray', icon: IconCircleDashed },
  booked: { color: 'blue', icon: IconCalendarCheck },
  done: { color: 'green', icon: IconCircleCheck },
  cancelled: { color: 'gray', icon: IconCircleX },
}
