import { IconArrowsDiff, IconCircleCheck, IconCircleDashed, type Icon } from '@tabler/icons-react'
import type { SourcedValue } from './clinical'

type Status = NonNullable<SourcedValue['status']>

// One mapping for every handover value: status is always icon, label and colour together (UX-3, UX-17).
export const statusMeta: Record<Status, { color: string; icon: Icon }> = {
  found: { color: 'green', icon: IconCircleCheck },
  missing: { color: 'orange', icon: IconCircleDashed },
  conflict: { color: 'red', icon: IconArrowsDiff },
}
