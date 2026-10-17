import { Stack, Text } from '@mantine/core'
import { useIsMutating } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Button from '../components/ActionButton'
import type { NotificationAction } from './notification-action'
import { fieldLabel } from './field-label'
import type { UserProblem } from './normalize-error'

export function NoticeTitle({ kind }: { kind: string }) {
    const { t } = useTranslation()
    return t(`notices.${kind}`)
}

function RecoveryAction({ action }: { action: NotificationAction }) {
    const { t } = useTranslation()
    const busy = useIsMutating() > 0
    return <Button variant="outline" size="compact-sm" pending={busy} onClick={action.onClick}>{t(action.labelKey)}</Button>
}

export function ProblemMessage({ problem, operation, action }: { problem: UserProblem; operation?: string; action?: NotificationAction }) {
    const { t } = useTranslation()
    return <Stack gap={4}>
        {operation && <Text size="sm" fw={600}>{t(`notices.${operation}`)}</Text>}
        <Text size="sm">{t(problem.messageKey)}</Text>
        {problem.fields.length > 0 && <Text size="sm">{t('notices.formFields', { fields: [...new Set(problem.fields.map((field) => fieldLabel(field.path, t)))].join(', ') })}</Text>}
        {action && <RecoveryAction action={action} />}
    </Stack>
}

export function NoticeRepeated({ count }: { count: number }) {
    const { t } = useTranslation()
    return <Text size="xs" c="dimmed">{t('notices.repeated', { count })}</Text>
}

export function NoticeOverflow() {
    const { t } = useTranslation()
    return t('notices.overflow')
}

export function JobMessage({ code }: { code: string }) {
    const { t } = useTranslation()
    return t(`notices.${code}`)
}
