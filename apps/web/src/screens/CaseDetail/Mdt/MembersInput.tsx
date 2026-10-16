import { Button, Group, Paper, Stack, TextInput } from '@mantine/core'
import { useIsMutating } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { MdtMember } from '../../../client/types.gen'

export default function MembersInput({ value, onChange }: { value: MdtMember[]; onChange: (value: MdtMember[]) => void }) {
  const { t } = useTranslation(), busy = useIsMutating() > 0
  return <Stack gap="xs">
    {value.map((member, index) => <Paper withBorder p="sm" key={index}><Stack gap="xs">
      <TextInput label={`${t('mdt.name')} (${index + 1})`} value={member.name} disabled={busy} onChange={(event) => { const name = event.currentTarget.value; onChange(value.map((row, i) => i === index ? { ...row, name } : row)) }} />
      <TextInput label={`${t('mdt.specialty')} (${index + 1})`} value={member.specialty} disabled={busy} onChange={(event) => { const specialty = event.currentTarget.value; onChange(value.map((row, i) => i === index ? { ...row, specialty } : row)) }} />
      <Group justify="flex-end"><Button variant="subtle" color="gray" size="compact-sm" disabled={busy} onClick={() => onChange(value.filter((_, i) => i !== index))}>{t('mdt.removeMember', { number: index + 1 })}</Button></Group>
    </Stack></Paper>)}
    <Button variant="outline" size="compact-sm" disabled={busy} onClick={() => onChange([...value, { name: '', specialty: '' }])}>{t('mdt.addMember')}</Button>
  </Stack>
}
