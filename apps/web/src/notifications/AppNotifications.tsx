import { Box, Button, Group, Notification, Paper, Portal, Stack, Text } from '@mantine/core'
import { Notifications, notifications, useNotifications, type NotificationData } from '@mantine/notifications'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { notificationStore } from './notify'
import classes from './AppNotifications.module.css'

const mobileQuery = '(max-width: 47.99em)'

function distribute(limit: number) {
    const state = notificationStore.getState()
    const items = [...state.notifications, ...state.queue]
    if (state.limit === limit && state.notifications.length === Math.min(items.length, limit)) return
    notificationStore.updateState((current) => ({ ...current, limit, notifications: items.slice(0, limit), queue: items.slice(limit) }))
}

function mobileViewport() { return window.matchMedia(mobileQuery).matches }

function subscribeViewport(callback: () => void) {
    const media = window.matchMedia(mobileQuery)
    distribute(media.matches ? 1 : 3)
    const change = () => {
        if (notificationStore.getState().limit !== 11) distribute(media.matches ? 1 : 3)
        callback()
    }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
}

function dialogTarget() {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter((node) => node.getAttribute('aria-hidden') !== 'true').at(-1) ?? document.body
}

function subscribeDialog(callback: () => void) {
    let previous = dialogTarget()
    const observer = new MutationObserver(() => {
        const current = dialogTarget()
        if (previous !== current) { previous = current; callback() }
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'aria-modal'] })
    return () => observer.disconnect()
}

function actionPending() { return document.querySelector('[data-action-pending="true"]') !== null }

function subscribePending(callback: () => void) {
    const observer = new MutationObserver(callback)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-action-pending'] })
    return () => observer.disconnect()
}

// Keep progress updates inside this leaf instead of rendering the notification host again.
function ProgressStatus() {
    const { t } = useTranslation()
    const pending = useSyncExternalStore(subscribePending, actionPending, () => false)
    return pending && <Paper className={classes.progress} withBorder shadow="sm" p="sm" role="status">
        <Text size="sm">{t('notices.working')}</Text>
    </Paper>
}

function Toast({ data }: { data: NotificationData }) {
    const { t } = useTranslation()
    return <Notification title={data.title} icon={data.icon} color={data.color} withBorder radius={8} role="presentation"
        onClose={() => {
            const focus = document.activeElement
            const root = focus?.closest('[data-notification]')
            notifications.hide(data.id ?? '', notificationStore)
            if (root) {
                const target = dialogTarget()
                const next = target.querySelector<HTMLElement>('button:not([disabled]):not([data-notification] button), [tabindex="0"]')
                next?.focus({ preventScroll: true })
            }
        }} closeButtonProps={{ 'aria-label': t('notices.close'), size: 44 }}
        classNames={{ root: classes.toast, body: classes.body, closeButton: classes.close }} data-notification={data.id}>
        {data.message}
    </Notification>
}

export default function AppNotifications() {
    const { t } = useTranslation()
    const mobile = useSyncExternalStore(subscribeViewport, mobileViewport, () => false)
    const target = useSyncExternalStore(subscribeDialog, dialogTarget, () => undefined)
    const portalKey = target?.getAttribute('aria-labelledby') ?? 'page'
    const state = useNotifications(notificationStore)
    const [expanded, setExpanded] = useState(false)
    const count = state.notifications.length + state.queue.length
    return <Portal key={portalKey} target={target}><Box className={classes.layer}>
        <Notifications withinPortal={false} store={notificationStore} position="top-center" autoClose={false} limit={expanded ? 11 : mobile ? 1 : 3}
            zIndex={1100} containerWidth="min(480px, calc(100vw - 16px))" transitionDuration={150} notificationMaxHeight="100dvh"
            allowDragDismiss={false} allowScrollDismiss={false}
            classNames={{ root: classes.host }} renderNotification={(data) => <Toast data={data} />} />
        {count > (mobile ? 1 : 3) && <Stack className={classes.controls}>
            <Group gap="xs" justify="center"><Text size="sm">{t('notices.total', { count })}</Text><Button size="compact-sm" variant="light" onClick={() => { distribute(expanded ? mobile ? 1 : 3 : 11); setExpanded(!expanded) }}>{t(expanded ? 'notices.collapse' : 'notices.expand')}</Button></Group>
        </Stack>}
        <ProgressStatus />
    </Box></Portal>
}
