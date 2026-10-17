import { Alert, Button, Group, Modal, NativeSelect, Radio, Stack, Text } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../api'
import { createReferralFromBundleMutation, createReferralMutation, listCasesQueryKey, listOrganizationsOptions } from '../../client/@tanstack/react-query.gen'
import type { Case, ReferralCreate } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import FormErrorSummary from '../../components/FormErrorSummary'
import FhirBundleInput from './FhirBundleInput'

function CreateForm({ actorId, close }: { actorId: string; close: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const busy = useIsMutating() > 0
  const kocs = useQuery(listOrganizationsOptions({ query: { kind: 'koc' } }))
  const [submitted, setSubmitted] = useState(false)
  const [method, setMethod] = useState('documents')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const form = useForm<ReferralCreate>({ initialValues: { koc_id: '' }, validateInputOnBlur: true,
    validate: { koc_id: (id) => kocs.data?.some((koc) => koc.id === id) ? null : 'referral.requiredKoc' } })
  const created = async (item: Case) => {
    await client.invalidateQueries({ queryKey: listCasesQueryKey() })
    await navigate({ to: '/referrer/cases/$caseId', params: { caseId: item.id } })
    close()
  }
  const create = useMutation({ ...createReferralMutation(), onSuccess: created })
  const importBundle = useMutation({ ...createReferralFromBundleMutation(), onSuccess: created, onError: () => setConfirm(false) })
  const importError = importBundle.error
  const bundleError = importError instanceof ApiError && [400, 415, 422].includes(importError.status ?? 0)
    ? `referral.fhir.error${importError.status}` : null
  return <Stack>
    <Text size="sm">{t(method === 'fhir' ? 'referral.fhir.intro' : 'referral.intro')}</Text>
    {kocs.isPending && <LoadingState />}
    {kocs.isError && <QueryError error={kocs.error} retry={() => { void kocs.refetch() }} pending={kocs.isFetching} />}
    {kocs.isSuccess && !kocs.data.length && <EmptyState title={t('referral.noKocs')} retry={() => { void kocs.refetch() }} />}
    {kocs.isSuccess && kocs.data.length > 0 && <form noValidate onSubmit={(event) => {
      if (busy) { event.preventDefault(); return }
      setSubmitted(true)
      if (method === 'fhir' && !file) setFileError('referral.fhir.required')
      form.onSubmit((body) => {
        if (method === 'fhir') { if (file) setConfirm(true) }
        else create.mutate({ body, headers: actorHeaders(actorId) })
      })(event)
    }}><Stack>
      {submitted && <FormErrorSummary errors={[...(Object.keys(form.errors).length ? [t('referral.requiredKoc')] : []), ...(method === 'fhir' && fileError ? [t(fileError)] : [])]} />}
      <NativeSelect label={t('referral.koc')} data={[{ value: '', label: t('referral.chooseKoc'), disabled: true }, ...kocs.data.map((item) => ({ value: item.id, label: item.name }))]}
        {...form.getInputProps('koc_id')} error={form.errors.koc_id ? t('referral.requiredKoc') : undefined} disabled={busy} />
      <Radio.Group label={t('referral.fhir.method')} value={method} onChange={(value) => { setMethod(value); create.reset(); importBundle.reset(); setFileError(undefined) }}>
        <Stack gap="xs" mt="xs"><Radio value="documents" label={t('referral.fhir.documents')} disabled={busy} /><Radio value="fhir" label={t('referral.fhir.bundle')} disabled={busy} /></Stack>
      </Radio.Group>
      {method === 'fhir' && <>
        <FhirBundleInput file={file} disabled={busy} error={fileError} onChange={(selected, error) => { setFile(selected); setFileError(error); importBundle.reset() }} />
        {importBundle.isError && (bundleError ? <Alert color="red" role="alert">{t(bundleError)}</Alert> : <QueryError error={importError} />)}
      </>}
      {method === 'documents' && create.isError && <QueryError error={create.error} />}
      <Group><Button type="submit" loading={create.isPending || importBundle.isPending} disabled={busy}>{t(method === 'fhir' ? 'referral.fhir.submit' : 'referral.start')}</Button><Button variant="default" onClick={close} disabled={busy}>{t('cancel')}</Button></Group>
    </Stack></form>}
    <Modal opened={confirm} onClose={() => { if (!busy) setConfirm(false) }} title={t('referral.fhir.confirmTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      <Stack>
        <Text size="sm">{t('referral.fhir.confirmText', { koc: kocs.data?.find((item) => item.id === form.values.koc_id)?.name })}</Text>
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{file?.name}</Text>
        <Group><Button loading={importBundle.isPending} disabled={busy || !file} onClick={() => {
          if (!busy && file) importBundle.mutate({ headers: actorHeaders(actorId), body: { file, koc_id: form.values.koc_id } })
        }}>{t('referral.fhir.submit')}</Button><Button variant="default" disabled={busy} onClick={() => setConfirm(false)}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
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
