import Button from '../../components/ActionButton'
import { pendingControlProps } from '../../components/pending-control'
import { Alert, Group, Modal, NativeSelect, Radio, Stack, Text } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../api'
import { createReferralFromBundleMutation, createReferralMutation, listCasesQueryKey, listOrganizationsOptions } from '../../client/@tanstack/react-query.gen'
import type { Case, ReferralCreate } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import FormErrorSummary from '../../components/FormErrorSummary'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../notifications/form-validation'
import FhirBundleInput from './FhirBundleInput'

function CreateForm({ actorId, close }: { actorId: string; close: () => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const busy = useIsMutating() > 0
  const kocs = useQuery(listOrganizationsOptions({ query: { kind: 'koc' } }))
  const id = useId()
  const [failedSubmits, setFailedSubmits] = useState(0)
  const [method, setMethod] = useState('documents')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const [confirm, setConfirm] = useState(false)
  const labels = { koc_id: t('referral.koc') }
  const form = useForm<ReferralCreate>({
    initialValues: { koc_id: '' }, validateInputOnBlur: true,
    validate: { koc_id: (id) => kocs.data?.some((koc) => koc.id === id) ? null : t('referral.requiredKoc') }
  })
  const fieldErrors = (error: unknown) => {
    const errors = apiFieldErrors(error, labels, t)
    if (Object.keys(errors).length) {
      form.setErrors({ ...form.errors, ...errors })
      setFailedSubmits((count) => count + 1)
    }
  }
  const created = async (item: Case) => {
    await client.invalidateQueries({ queryKey: listCasesQueryKey() })
    await navigate({ to: '/referrer/cases/$caseId', params: { caseId: item.id } })
    close()
  }
  const create = useMutation({ ...createReferralMutation(), onError: fieldErrors, onSuccess: created })
  const importBundle = useMutation({ ...createReferralFromBundleMutation(), onSuccess: created, onError: (error) => { setConfirm(false); fieldErrors(error) } })
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
      const missingFile = method === 'fhir' && !file
      if (missingFile) setFileError('referral.fhir.required')
      form.onSubmit((body) => {
        if (method === 'fhir') { if (file) setConfirm(true); else setFailedSubmits((count) => count + 1) }
        else create.mutate({ body, headers: actorHeaders(actorId) })
      }, (errors) => {
        setFailedSubmits((count) => count + 1)
        notifyFormErrors(errors, labels, t, id)
      })(event)
    }}><Stack>
      {failedSubmits > 0 && <FormErrorSummary errors={[...formProblems(form.errors, labels), ...(method === 'fhir' && fileError ? [t(fileError)] : [])]} focusKey={failedSubmits} />}
      <NativeSelect label={t('referral.koc')} data={[{ value: '', label: t('referral.chooseKoc'), disabled: true }, ...kocs.data.map((item) => ({ value: item.id, label: item.name }))]}
        {...form.getInputProps('koc_id')} {...pendingControlProps(busy)} />
      <Radio.Group label={t('referral.fhir.method')} value={method} onChange={(value) => { setMethod(value); create.reset(); importBundle.reset(); setFileError(undefined) }}>
        <Stack gap="xs" mt="xs"><Radio value="documents" label={t('referral.fhir.documents')} {...pendingControlProps(busy)} /><Radio value="fhir" label={t('referral.fhir.bundle')} {...pendingControlProps(busy)} /></Stack>
      </Radio.Group>
      {method === 'fhir' && <>
        <FhirBundleInput file={file} disabled={busy} error={fileError} onChange={(selected, error) => { setFile(selected); setFileError(error); importBundle.reset() }} />
        {importBundle.isError && bundleError && <Alert color="red" role="alert">{t(bundleError)}</Alert>}
      </>}
      <Group><Button type="submit" pending={busy}>{t(method === 'fhir' ? 'referral.fhir.submit' : 'referral.start')}</Button><Button variant="default" onClick={close} pending={busy}>{t('cancel')}</Button></Group>
    </Stack></form>}
    <Modal opened={confirm} onClose={() => { if (!busy) setConfirm(false) }} title={t('referral.fhir.confirmTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      <Stack>
        <Text size="sm">{t('referral.fhir.confirmText', { koc: kocs.data?.find((item) => item.id === form.values.koc_id)?.name })}</Text>
        <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{file?.name}</Text>
        <Group><Button pending={busy} disabled={!file} onClick={() => {
          if (!busy && file) importBundle.mutate({ headers: actorHeaders(actorId), body: { file, koc_id: form.values.koc_id } })
        }}>{t('referral.fhir.submit')}</Button><Button variant="default" pending={busy} onClick={() => setConfirm(false)}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
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
