import { Box, Menu, UnstyledButton } from '@mantine/core'
import { useIsMutating } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { IconChevronDown, IconSwitchHorizontal } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Actor } from '../client/types.gen'
import { useSession } from '../session'
import { QueryError } from './DataState'
import { usePeople } from './people'
import { PersonDetails, PersonLabel } from './PersonChip'

/** The signed-in person: identity, workplace and contacts, and switching to another person. */
export default function UserMenu({ actor, onLeave }: { actor: Actor; onLeave: () => void }) {
  const { t } = useTranslation()
  const session = useSession()
  const navigate = useNavigate()
  const busy = useIsMutating() > 0
  const { organization, organizations } = usePeople()
  return <Menu position="bottom-end" width={300} shadow="md">
    <Menu.Target>
      <UnstyledButton aria-label={t('userMenu', { name: actor.name })} p={4} style={{ borderRadius: 'var(--mantine-radius-md)' }}>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <PersonLabel name={actor.name} secondary={t(actor.role)} textVisibleFrom="sm" />
          <IconChevronDown size={16} aria-hidden />
        </Box>
      </UnstyledButton>
    </Menu.Target>
    <Menu.Dropdown>
      <Box p="sm"><PersonDetails person={{ actor, organization: organization(actor.organization_id) }} /></Box>
      {organizations.isError && <Box px="sm" pb="sm"><QueryError error={organizations.error} pending={organizations.isFetching} retry={() => { void organizations.refetch() }} /></Box>}
      <Menu.Divider />
      <Menu.Item leftSection={<IconSwitchHorizontal size={16} aria-hidden />} disabled={busy} onClick={async () => {
        onLeave()
        await session.leaveIdentity()
        await navigate({ to: '/', replace: true })
      }}>{t('changeIdentity')}</Menu.Item>
    </Menu.Dropdown>
  </Menu>
}
