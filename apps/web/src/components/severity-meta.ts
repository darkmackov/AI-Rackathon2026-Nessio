import { IconAlertTriangle, IconCircleX, IconInfoCircle, type Icon } from '@tabler/icons-react'
import type { Severity } from '../client/types.gen'

// One mapping for every screen: severity is always icon, label and colour together (UX-17).
export const severityMeta: Record<Severity, { color: string; icon: Icon }> = {
  blocker: { color: 'red', icon: IconCircleX },
  warning: { color: 'orange', icon: IconAlertTriangle },
  info: { color: 'blue', icon: IconInfoCircle },
}
