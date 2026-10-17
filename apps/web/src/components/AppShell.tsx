import { Anchor, AppShell as MantineAppShell, Badge, Box, Button, Container, Group, Image, Menu, Tooltip } from '@mantine/core'
import { Link, Outlet } from '@tanstack/react-router'
import { IconCheck, IconFlask, IconLanguage } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiMode } from '../config'
import { changeLanguage } from '../i18n'
import { roleHome, useSession } from '../session'
import DemoClock from './DemoClock'
import DemoPanel from './DemoPanel'
import UserMenu from './UserMenu'

const languages = [{ value: 'cs', label: 'Čeština' }, { value: 'en', label: 'English' }] as const

function LanguageMenu() {
  const { t, i18n } = useTranslation()
  return <Menu position="bottom-end">
    <Menu.Target>
      <Button variant="subtle" color="gray" size="compact-md" leftSection={<IconLanguage size={18} aria-hidden />} aria-label={t('changeLanguage')}>
        {i18n.language.toUpperCase()}
      </Button>
    </Menu.Target>
    <Menu.Dropdown>
      {languages.map((language) => <Menu.Item key={language.value} lang={language.value} onClick={() => { void changeLanguage(language.value) }}
        rightSection={i18n.language === language.value ? <IconCheck size={16} aria-hidden /> : undefined} aria-current={i18n.language === language.value || undefined}>
        {language.label}
      </Menu.Item>)}
    </Menu.Dropdown>
  </Menu>
}

export default function AppShell() {
  const { t } = useTranslation()
  const session = useSession()
  const [demoOpen, setDemoOpen] = useState(false)
  const mode = t(apiMode === 'mock' ? 'demoData' : 'realApi')

  return <MantineAppShell padding={0}>
    <Anchor href="#main-content" className="skip-link">{t('skip')}</Anchor>
    <header className="app-header">
      <Container size="xl" py={8}>
        <Group justify="space-between" gap="sm" mih={44}>
          <nav aria-label={t('navigation')}>
            <Anchor component={Link} to={session.actor ? roleHome(session.actor.role) : '/'} fw={700} fz={{ base: 'md', sm: 'lg' }} c="var(--mantine-color-text)" underline="never"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', overflowWrap: 'normal' }}>
              <Image src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" aria-hidden w={40} h={44} fit="contain" style={{ flexShrink: 0 }} />
              {t('appName')}
            </Anchor>
          </nav>
          <Group gap="xs" wrap="nowrap">
            {session.actor
              ? <>
                <Group gap="xs" visibleFrom="sm"><DemoClock compact /></Group>
                <Tooltip label={mode}>
                  <Button variant="light" size="compact-md" aria-label={t('demo')} leftSection={<IconFlask size={16} aria-hidden />} onClick={() => setDemoOpen(true)}
                    styles={{ section: { marginInlineEnd: 0 } }}><Box component="span" visibleFrom="sm" ml={6}>{t('demo')}</Box></Button>
                </Tooltip>
              </>
              : <Badge variant="light" color={apiMode === 'mock' ? 'nessie' : 'gray'} leftSection={<IconFlask size={12} aria-hidden />}>{mode}</Badge>}
            <LanguageMenu />
            {session.actor && <UserMenu actor={session.actor} onLeave={() => setDemoOpen(false)} />}
          </Group>
        </Group>
      </Container>
    </header>
    <MantineAppShell.Main id="main-content" tabIndex={-1} mih={0}>
      <Container size="xl" py="lg"><Outlet key={session.actorId ?? 'entry'} /></Container>
    </MantineAppShell.Main>
    {session.actor && <DemoPanel key={session.actor.id} opened={demoOpen} onClose={() => setDemoOpen(false)} />}
  </MantineAppShell>
}
