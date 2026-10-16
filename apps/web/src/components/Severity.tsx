import { Badge, type MantineSize } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { Severity } from '../client/types.gen'
import { severityMeta } from './severity-meta'

export function SeverityBadge({ severity, size = 'md' }: { severity: Severity; size?: MantineSize }) {
  const { t } = useTranslation()
  const { color, icon: SeverityIcon } = severityMeta[severity]
  return <Badge size={size} variant="light" color={color} c="dark.9" style={{ flexShrink: 0 }} leftSection={<SeverityIcon size={14} aria-hidden />}>{t(`caseDetail.severity.${severity}`)}</Badge>
}