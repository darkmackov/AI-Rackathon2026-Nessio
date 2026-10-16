import { Button, Group, Modal, NativeSelect, Stack, Text } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { createReferralMutation, listCasesQueryKey, listOrganizationsOptions } from '../../client/@tanstack/react-query.gen'
import type { ReferralCreate } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import FormErrorSummary from '../../components/FormErrorSummary'

function CreateForm({ actorId, close }: { actorId: string; close: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const busy = useIsMutating() > 0
  const kocs = useQuery(listOrganizationsOptions({ query: { kind: 'koc' } }))
  const [submitted, setSubmitted] = useState(false)
  const form = useForm<ReferralCreate>({ initialValues: { koc_id: '' }, validateInputOnBlur: true,
    validate: { koc_id: (id) => kocs.data?.some((koc) => koc.id === id) ? null : 'referral.requiredKoc' } })
  const create = useMutation({ ...createReferralMutation(), onSuccess: async (item) => {
    await client.invalidateQueries({ queryKey: listCasesQueryKey() })
    await navigate({ to: '/referrer/cases/$caseId', params: { caseId: item.id } })
    close()
  } })
  return <Stack>
    <Text size="sm">{t('referral.intro')}</Text>
    {kocs.isPending && <LoadingState />}
    {kocs.isError && <QueryError error={kocs.error} retry={() => { void kocs.refetch() }} pending={kocs.isFetching} />}
    {kocs.isSuccess && !kocs.data.length && <EmptyState title={t('referral.noKocs')} retry={() => { void kocs.refetch() }} />}
    {kocs.isSuccess && kocs.data.length > 0 && <form noValidate onSubmit={(event) => {
      if (busy) { event.preventDefault(); return }
      setSubmitted(true)
      form.onSubmit((body) => create.mutate({ body, headers: actorHeaders(actorId) }))(event)
    }}><Stack>
      {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={[t('referral.requiredKoc')]} />}
      <NativeSelect label={t('referral.koc')} data={[{ value: '', label: t('referral.chooseKoc'), disabled: true }, ...kocs.data.map((item) => ({ value: item.id, label: item.name }))]}
        {...form.getInputProps('koc_id')} error={form.errors.koc_id ? t('referral.requiredKoc') : undefined} disabled={busy} />
      {create.isError && <QueryError error={create.error} />}
      <Group><Button type="submit" loading={create.isPending} disabled={busy}>{t('referral.start')}</Button><Button variant="default" onClick={close} disabled={busy}>{t('cancel')}</Button></Group>
    </Stack></form>}
  </Stack>
}

export default function CreateReferral({ actorId }: { actorId: string }) {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)
  const busy = useIsMutating() > 0
  return <>
    <Button onClick={() => setOpened(true)} disabled={busy}>{t('referral.create')}</Button>
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false) }} title={t('referral.createTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {opened && <CreateForm actorId={actorId} close={() => setOpened(false)} />}
    </Modal>
  </>
}
