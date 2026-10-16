import { Button, NativeSelect, Paper, Stack, Text } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listActorsOptions } from '../client/@tanstack/react-query.gen'
import LoadingState, { EmptyState, QueryError } from '../components/DataState'
import PageHeading from '../components/PageHeading'
import { isUserRole, roleHome, useSession, type UserRole } from '../session'

export default function IdentitySelection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useSession()
  const { redirect } = useSearch({ from: '/' })
  const [role, setRole] = useState<UserRole>('referring_doctor')
  const [person, setPerson] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const people = useQuery(listActorsOptions({ query: { role } }))

  async function submit() {
    if (!person) return
    setPending(true)
    setError(null)
    try {
      const actor = await session.selectActor(person)
      if (redirect) await navigate({ href: redirect, replace: true })
      else await navigate({ to: roleHome(actor.role), replace: true })
    } catch (failure) { setError(failure) }
    finally { setPending(false) }
  }

  return <Stack maw={560} mx="auto" py="xl">
    <div><PageHeading size="h2">{t('selectTitle')}</PageHeading><Text c="dimmed" mt="xs">{t('selectIntro')}</Text></div>
    <Paper withBorder p="lg">
      <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <Stack>
          <NativeSelect label={t('role')} value={role} disabled={pending}
            data={[{ value: 'referring_doctor', label: t('referring_doctor') }, { value: 'coordinator', label: t('coordinator') }]}
            onChange={(event) => {
              if (isUserRole(event.currentTarget.value)) setRole(event.currentTarget.value)
              setPerson(''); setError(null)
            }} />
          {people.isPending && <LoadingState />}
          {people.isError && <QueryError error={people.error} pending={people.isFetching} retry={() => { void people.refetch() }} />}
          {people.isSuccess && (people.data.length ? <NativeSelect label={t('person')} value={person} disabled={pending}
            data={[{ value: '', label: t('choosePerson') }, ...people.data.map((actor) => ({ value: actor.id, label: actor.name }))]}
            onChange={(event) => { setPerson(event.currentTarget.value); setError(null) }} />
            : <EmptyState title={t('emptyDirectory')} retry={() => { void people.refetch() }} />)}
          {error != null && <QueryError error={error} retry={() => { void submit() }} />}
          <Button type="submit" loading={pending} disabled={!person || !people.isSuccess}>{t('continue')}</Button>
        </Stack>
      </form>
    </Paper>
  </Stack>
}
