import Button from '../../components/ActionButton'
import { pendingControlProps } from '../../components/pending-control'
import { Group, Modal, NativeSelect, Stack, Text } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { createReferralMutation, listCasesQueryKey, listOrganizationsOptions } from '../../client/@tanstack/react-query.gen'
import type { ReferralCreate } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import FormErrorSummary from '../../components/FormErrorSummary'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../notifications/form-validation'

function CreateForm({ actorId, close }: { actorId: string; close: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const busy = useIsMutating() > 0
  const kocs = useQuery(listOrganizationsOptions({ query: { kind: 'koc' } }))
  const id = useId()
  const [failedSubmits, setFailedSubmits] = useState(0)
  const labels = { koc_id: t('referral.koc') }
  const form = useForm<ReferralCreate>({
    initialValues: { koc_id: '' }, validateInputOnBlur: true,
    validate: { koc_id: (id) => kocs.data?.some((koc) => koc.id === id) ? null : t('referral.requiredKoc') }
  })
  const create = useMutation({
    ...createReferralMutation(), onError: (error) => {
      const errors = apiFieldErrors(error, labels, t)
      if (Object.keys(errors).length) {
        form.setErrors({ ...form.errors, ...errors })
        setFailedSubmits((count) => count + 1)
      }
    }, onSuccess: async (item) => {
      await client.invalidateQueries({ queryKey: listCasesQueryKey() })
      await navigate({ to: '/referrer/cases/$caseId', params: { caseId: item.id } })
      close()
    }
  })
  return <Stack>
    <Text size="sm">{t('referral.intro')}</Text>
    {kocs.isPending && <LoadingState />}
    {kocs.isError && <QueryError error={kocs.error} retry={() => { void kocs.refetch() }} pending={kocs.isFetching} />}
    {kocs.isSuccess && !kocs.data.length && <EmptyState title={t('referral.noKocs')} retry={() => { void kocs.refetch() }} />}
    {kocs.isSuccess && kocs.data.length > 0 && <form noValidate onSubmit={(event) => {
      if (busy) { event.preventDefault(); return }
      form.onSubmit((body) => create.mutate({ body, headers: actorHeaders(actorId) }), (errors) => {
        setFailedSubmits((count) => count + 1)
        notifyFormErrors(errors, labels, t, id)
      })(event)
    }}><Stack>
        {failedSubmits > 0 && <FormErrorSummary errors={formProblems(form.errors, labels)} focusKey={failedSubmits} />}
        <NativeSelect label={t('referral.koc')} data={[{ value: '', label: t('referral.chooseKoc'), disabled: true }, ...kocs.data.map((item) => ({ value: item.id, label: item.name }))]}
          {...form.getInputProps('koc_id')} {...pendingControlProps(busy)} />
        {create.isError && <QueryError error={create.error} />}
        <Group><Button type="submit" pending={busy || create.isPending}>{t('referral.start')}</Button><Button variant="default" onClick={close} pending={busy}>{t('cancel')}</Button></Group>
      </Stack></form>}
  </Stack>
}

export default function CreateReferral({ actorId }: { actorId: string }) {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)
  const busy = useIsMutating() > 0
  return <>
    <Button onClick={() => setOpened(true)} pending={busy}>{t('referral.create')}</Button>
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false) }} title={t('referral.createTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      {opened && <CreateForm actorId={actorId} close={() => setOpened(false)} />}
    </Modal>
  </>
}
