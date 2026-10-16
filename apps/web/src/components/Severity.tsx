import { Badge } from '@mantine/core'
import { IconAlertTriangle, IconCircleX, IconInfoCircle, type Icon } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Severity } from '../client/types.gen'

// One mapping for every screen: severity is always icon, label and colour together (UX-17).
const severityMeta: Record<Severity, { color: string; icon: Icon }> = {
  blocker: { color: 'red', icon: IconCircleX },
  warning: { color: 'orange', icon: IconAlertTriangle },
  info: { color: 'blue', icon: IconInfoCircle },
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useTranslation()
  const { color, icon: SeverityIcon } = severityMeta[severity]
  return <Badge variant="light" color={color} c="dark.9" leftSection={<SeverityIcon size={14} aria-hidden />}>{t(`caseDetail.severity.${severity}`)}</Badge>
}
