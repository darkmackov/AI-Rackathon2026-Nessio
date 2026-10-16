import { Anchor, AppShell as MantineAppShell, Badge, Button, Container, Group, NativeSelect, Stack, Text } from '@mantine/core'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listOrganizationsOptions } from '../client/@tanstack/react-query.gen'
import { apiMode } from '../config'
import { changeLanguage } from '../i18n'
import { roleHome, useSession } from '../session'
import DemoClock from './DemoClock'
import DemoPanel from './DemoPanel'
import { QueryError } from './DataState'

export default function AppShell() {
  const { t, i18n } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const busy = useIsMutating() > 0
  const [demoOpen, setDemoOpen] = useState(false)
  const organizations = useQuery({ ...listOrganizationsOptions(), enabled: !!session.actor })
  const organization = organizations.data?.find((item) => item.id === session.actor?.organization_id)

  return <MantineAppShell padding={0}>
    <Anchor href="#main-content" className="skip-link">{t('skip')}</Anchor>
    <header className="app-header">
      <Container size="xl" py="md">
        <Group justify="space-between" align="flex-start" gap="md">
          <Stack gap={4}>
            <Anchor component={Link} to={session.actor ? roleHome(session.actor.role) : '/'} fw={750} size="lg" underline="never">{t('appName')}</Anchor>
            <Badge color={apiMode === 'mock' ? 'blue' : 'gray'} variant="light">{t(apiMode === 'mock' ? 'demoData' : 'realApi')}</Badge>
          </Stack>
          <Group gap="md" align="flex-end">
            <NativeSelect label={t('language')} value={i18n.language} data={[{ value: 'cs', label: 'Čeština' }, { value: 'en', label: 'English' }]}
              onChange={(event) => { void changeLanguage(event.currentTarget.value === 'en' ? 'en' : 'cs') }} />
            {session.actor && <Button variant="outline" onClick={() => setDemoOpen(true)}>{t('demo')}</Button>}
          </Group>
        </Group>
        {session.actor && <Stack mt="md" gap="sm">
          <Group justify="space-between" align="flex-start">
            <div><Text fw={600}>{session.actor.name}</Text><Text size="sm" c="dimmed">{t(session.actor.role)} · {organization?.name ?? t('unavailable')}</Text></div>
            <Button size="compact-sm" variant="outline" disabled={busy} onClick={async () => {
              setDemoOpen(false)
              await session.leaveIdentity()
              await navigate({ to: '/', replace: true })
            }}>{t('changeIdentity')}</Button>
          </Group>
          {organizations.isError && <QueryError error={organizations.error} pending={organizations.isFetching} retry={() => { void organizations.refetch() }} />}
          <Group justify="space-between" align="center">
            <nav aria-label={t('navigation')}><Anchor component={Link} to={roleHome(session.actor.role)} fw={600}>
              {t(session.actor.role === 'coordinator' ? 'dashboardTitle' : 'identityTitle')}
            </Anchor></nav>
            <DemoClock compact />
          </Group>
        </Stack>}
      </Container>
    </header>
    <MantineAppShell.Main id="main-content" tabIndex={-1} mih={0}>
      <Container size="xl" py="xl"><Outlet key={session.actorId ?? 'entry'} /></Container>
    </MantineAppShell.Main>
    {session.actor && <DemoPanel key={session.actor.id} opened={demoOpen} onClose={() => setDemoOpen(false)} />}
  </MantineAppShell>
}
