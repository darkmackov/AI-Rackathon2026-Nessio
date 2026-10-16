import { Anchor, Avatar, Box, Group, Popover, Stack, Text, UnstyledButton, type MantineSize } from '@mantine/core'
import { IconBuildingHospital, IconMail, IconPhone } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { usePeople, type Person } from './people'

const avatarSize = { xs: 20, sm: 26, md: 34 } as const

export function PersonDetails({ person }: { person: Person }) {
  const { t, i18n } = useTranslation()
  const { actor, organization } = person
  const contact = actor ?? organization
  const line = (icon: ReactNode, label: string, value: ReactNode) => <Group gap={8} wrap="nowrap" align="flex-start">
    {icon}<div><Text size="xs" c="dimmed">{label}</Text><Text size="sm">{value}</Text></div>
  </Group>
  return <Stack gap="xs">
    <div>
      <Text fw={600}>{contact.name}</Text>
      {actor && <Text size="sm" c="dimmed">{i18n.exists(actor.role) ? t(actor.role) : actor.role}</Text>}
    </div>
    {actor && line(<IconBuildingHospital size={16} aria-hidden />, t('workplace'), <>{organization?.name ?? t('unavailable')}{organization?.address && <Text span display="block" size="xs" c="dimmed">{organization.address}</Text>}</>)}
    {!actor && organization.address && line(<IconBuildingHospital size={16} aria-hidden />, t('address'), organization.address)}
    {line(<IconPhone size={16} aria-hidden />, t('phone'), contact.phone ? <Anchor href={`tel:${contact.phone}`} size="sm">{contact.phone}</Anchor> : t('unavailable'))}
    {line(<IconMail size={16} aria-hidden />, t('email'), contact.email ? <Anchor href={`mailto:${contact.email}`} size="sm">{contact.email}</Anchor> : t('unavailable'))}
  </Stack>
}

export function PersonLabel({ name, size = 'sm', secondary, textVisibleFrom }: { name: string; size?: keyof typeof avatarSize; secondary?: ReactNode; textVisibleFrom?: 'sm' }) {
  return <Group gap={8} wrap="nowrap">
    <Avatar name={name} color="initials" size={avatarSize[size]} aria-hidden />
    <Box miw={0} visibleFrom={textVisibleFrom}>
      <Text size={size as MantineSize} fw={500} lh={1.25} style={{ overflowWrap: 'break-word' }}>{name}</Text>
      {secondary && <Text size="xs" c="dimmed" lh={1.25}>{secondary}</Text>}
    </Box>
  </Group>
}

/** A person or organisation from the directory: avatar and name, with contacts on click. */
export default function PersonChip({ id, size = 'sm', secondary, withDetails = true }: {
  id?: string | null; size?: keyof typeof avatarSize; secondary?: ReactNode; withDetails?: boolean;
}) {
  const { t } = useTranslation()
  const { person } = usePeople()
  const found = person(id)
  if (!found) return <Text size={size as MantineSize} c="dimmed">{t('unavailable')}</Text>
  const name = (found.actor ?? found.organization).name
  const label = <PersonLabel name={name} size={size} secondary={secondary} />
  if (!withDetails) return label
  return <Popover position="bottom-start" shadow="md" width={280} withArrow>
    <Popover.Target>
      <UnstyledButton aria-label={t('contactsOf', { name })} style={{ borderRadius: 'var(--mantine-radius-sm)' }}>{label}</UnstyledButton>
    </Popover.Target>
    <Popover.Dropdown><PersonDetails person={found} /></Popover.Dropdown>
  </Popover>
}
