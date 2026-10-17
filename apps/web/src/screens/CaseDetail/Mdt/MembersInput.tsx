import { ActionIcon, Button, Group, Stack, TextInput } from '@mantine/core'
import { useIsMutating } from '@tanstack/react-query'
import { IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { MdtMember } from '../../../client/types.gen'

export default function MembersInput({ value, onChange }: { value: MdtMember[]; onChange: (value: MdtMember[]) => void }) {
  const { t } = useTranslation(), busy = useIsMutating() > 0
  return <Stack gap="xs">
    {value.map((member, index) => <Group key={index} gap="xs" align="flex-end" wrap="nowrap">
      <TextInput flex={1} label={`${t('mdt.name')} (${index + 1})`} value={member.name} disabled={busy} onChange={(event) => { const name = event.currentTarget.value; onChange(value.map((row, i) => i === index ? { ...row, name } : row)) }} />
      <TextInput flex={1} label={`${t('mdt.specialty')} (${index + 1})`} value={member.specialty} disabled={busy} onChange={(event) => { const specialty = event.currentTarget.value; onChange(value.map((row, i) => i === index ? { ...row, specialty } : row)) }} />
      <ActionIcon variant="subtle" color="gray" size={36} disabled={busy} aria-label={t('mdt.removeMember', { number: index + 1 })} onClick={() => onChange(value.filter((_, i) => i !== index))}><IconTrash size={18} aria-hidden /></ActionIcon>
    </Group>)}
    <Group><Button variant="outline" size="compact-sm" disabled={busy} onClick={() => onChange([...value, { name: '', specialty: '' }])}>{t('mdt.addMember')}</Button></Group>
  </Stack>
}
