import { Anchor, Button, Group, Stack } from '@mantine/core'
import { Link, type ErrorComponentProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export default function RouteFailure({ reset }: ErrorComponentProps) {
    const { t } = useTranslation()
    return <Stack component="section" p="md">
        <Group><Button onClick={reset}>{t('retry')}</Button><Anchor component={Link} to="/">{t('home')}</Anchor></Group>
    </Stack>
}