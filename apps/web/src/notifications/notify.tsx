import { Stack } from '@mantine/core'
import { createNotificationsStore, notifications, type NotificationData } from '@mantine/notifications'
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconInfoCircle } from '@tabler/icons-react'
import { ApiError } from '../api-error'
import type { Job } from '../client/types.gen'
import { normalizeError } from './normalize-error'
import type { NotificationAction } from './notification-action'
import { JobMessage, NoticeOverflow, NoticeRepeated, NoticeTitle, ProblemMessage } from './NotificationText'

export const notificationStore = createNotificationsStore()
const seenErrors = new WeakSet<object>()
const dismissed = new Set<string>()
const maximum = 10
const appearance = {
    error: { color: 'red', icon: IconAlertCircle, priority: 3 },
    warning: { color: 'orange', icon: IconAlertTriangle, priority: 2 },
    success: { color: 'green', icon: IconCircleCheck, priority: 0 },
    info: { color: 'blue', icon: IconInfoCircle, priority: 1 },
}

function show(id: string, kind: keyof typeof appearance, message: NotificationData['message'], automatic = false) {
    if (automatic && dismissed.has(id)) return
    const state = notificationStore.getState()
    const entries = [...state.notifications, ...state.queue]
    const current = entries.find((entry) => entry.id === id)
    const { color, icon: Icon, priority } = appearance[kind]
    const count = typeof current?.['data-occurrences'] === 'number' ? current['data-occurrences'] + 1 : 1
    const props: NotificationData = {
        id, color, priority, message: count > 1 ? <Stack gap={4}>{message}<NoticeRepeated count={count} /></Stack> : message, title: <NoticeTitle kind={kind} />, icon: <Icon size={22} aria-hidden />,
        'data-occurrences': count,
        autoClose: false, withCloseButton: true, withBorder: true, radius: 8,
        role: id.startsWith('warning:form:') ? 'group' : kind === 'error' || kind === 'warning' ? 'alert' : 'status',
        onClose: () => { if (dismissed.size >= 100) dismissed.delete(dismissed.values().next().value ?? ''); dismissed.add(id) },
    }
    if (current) { notifications.update(props, notificationStore); return }
    if (entries.length >= maximum - 1) {
        if (!entries.some((entry) => entry.id === 'notification-overflow')) notifications.show({ ...props, id: 'notification-overflow', message: <NoticeOverflow />, title: <NoticeTitle kind="warning" />, color: 'orange', role: 'alert' }, notificationStore)
        return
    }
    dismissed.delete(id)
    notifications.show(props, notificationStore)
}

export function notifyWarning(id: string, message: NotificationData['message']) { show(`warning:${id}`, 'warning', message) }
export function notifyError(id: string, message: NotificationData['message']) { show(`error:${id}`, 'error', message) }
export function notifySuccess(id: string, message: NotificationData['message']) { show(`success:${id}`, 'success', message) }
export function notifyInfo(id: string, message: NotificationData['message']) { show(`info:${id}`, 'info', message) }

export function notifyApiError(error: unknown, options: { scope?: string; automatic?: boolean; action?: NotificationAction } = {}) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'CancelledError' || error instanceof ApiError && error.detail instanceof DOMException && error.detail.name === 'AbortError')) return
    if (typeof error === 'object' && error !== null) {
        if (seenErrors.has(error)) return
        seenErrors.add(error)
    }
    const problem = normalizeError(error)
    const shared = ['network', 'unavailable', 'timeout'].includes(problem.code)
    const scope = shared ? 'connection' : options.scope ?? (error instanceof ApiError ? error.scope : undefined) ?? 'operation'
    const operation = error instanceof ApiError ? error.operation : undefined
    const id = `api:${scope}:${problem.code}`
    const action = options.action && { ...options.action, onClick: () => {
        notifications.hide(id, notificationStore)
        options.action?.onClick()
    } }
    show(id, problem.severity, <ProblemMessage problem={problem} operation={operation} action={action} />, options.automatic)
}

export function notifyJobFailure(job: Job) {
    if (job.status !== 'failed') return
    const code = job.kind === 'ask_case' ? 'jobAsk' : job.kind === 'draft' ? 'jobDraft' : 'jobIngest'
    show(`job:${job.id}`, 'error', <JobMessage code={code} />, true)
}

export function clearNotifications() {
    notifications.clean(notificationStore)
    dismissed.clear()
}

export function allowNotificationRecovery(scope?: string) {
    for (const key of dismissed) {
        if (key.startsWith('api:') && (!scope || key.startsWith('api:connection:') || key.startsWith(`api:${scope}:`))) dismissed.delete(key)
    }
}
