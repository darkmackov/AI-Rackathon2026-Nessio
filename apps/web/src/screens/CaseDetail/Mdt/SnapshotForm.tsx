import { pendingControlProps } from '../../../components/pending-control'
import Button from '../../../components/ActionButton'
import DateInput from '../../../components/DateInput'
import { Alert, Group, Modal, NativeSelect, Stack, Text } from '@mantine/core'
import { useForm, type FormErrors } from '@mantine/form'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { createMdtSnapshotMutation, getMdtBoardQueryKey, listMdtBoardsOptions, listMdtBoardsQueryKey, updateMdtBoardMembersMutation } from '../../../client/@tanstack/react-query.gen'
import type { Case, MdtBoard, MdtBoardMembersUpdate, MdtSnapshotCreate } from '../../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../../components/DataState'
import FormErrorSummary from '../../../components/FormErrorSummary'
import { validDocumentDate } from '../../../components/documents/document-utils'
import { refreshCaseResults } from '../../../components/documents/use-document-ingest'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../../../notifications/form-validation'
import { normalizeError } from '../../../notifications/normalize-error'
import { formatDate } from '../../../time'
import MembersInput from './MembersInput'

function RosterForm({ board, actorId, saved }: { board: MdtBoard; actorId: string; saved: () => void }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false)
  const form = useForm<MdtBoardMembersUpdate>({
    initialValues: { members: structuredClone(board.members ?? []) }, validateInputOnBlur: true, validateInputOnChange: false,
    validate: (value) => {
      const errors: FormErrors = {}
      value.members.forEach((member, index) => {
        if (!member.name.trim()) errors[`members.${index}.name`] = t('mdt.required')
        if (!member.specialty.trim()) errors[`members.${index}.specialty`] = t('mdt.required')
      })
      return errors
    }
  })
  const labels: Record<string, string> = {}
  form.values.members.forEach((_, index) => {
    labels[`members.${index}.name`] = `${t('mdt.name')} (${index + 1})`
    labels[`members.${index}.specialty`] = `${t('mdt.specialty')} (${index + 1})`
  })
  const mutation = useMutation({
    ...updateMdtBoardMembersMutation(), onError: (error) => form.setErrors(apiFieldErrors(error, labels, t)), onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: listMdtBoardsQueryKey() }), client.invalidateQueries({ queryKey: getMdtBoardQueryKey({ path: { board_id: board.id } }) })]); saved()
    }
  })
  return <form noValidate onSubmit={(event) => { if (busy) { event.preventDefault(); return }; setSubmitted(true); form.onSubmit((body) => mutation.mutate({ body, path: { board_id: board.id }, headers: actorHeaders(actorId) }), (errors) => notifyFormErrors(errors, labels, t, `mdt-roster:${board.id}`))(event) }}><Stack>
    <Text size="sm">{t('mdt.rosterHelp')}</Text>
    {submitted && <FormErrorSummary errors={formProblems(form.errors, labels)} />}
    <MembersInput value={form.values.members} onChange={(value) => form.setFieldValue('members', value)} errors={form.errors} onBlur={(path) => form.validateField(path)} />
    {mutation.isError && <QueryError error={mutation.error} />}
    <Button type="submit" pending={busy || mutation.isPending}>{t('mdt.save')}</Button>
  </Stack></form>
}

export default function SnapshotForm({ item, actorId, showFindings }: { item: Case; actorId: string; showFindings: () => void }) {
  const { t, i18n } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false), [confirm, setConfirm] = useState(false), [roster, setRoster] = useState(false), [saved, setSaved] = useState(false)
  const boards = useQuery(listMdtBoardsOptions({ headers: actorHeaders(actorId) }))
  const choices = boards.data?.filter((board) => board.organization_id === item.koc_id) ?? []
  const form = useForm<MdtSnapshotCreate>({
    initialValues: { board_id: item.mdt_board_id ?? '', mdt_date: item.mdt_date ?? '' }, validateInputOnBlur: true, validateInputOnChange: false,
    validate: { board_id: (id) => choices.some((board) => board.id === id) ? null : t('mdt.required'), mdt_date: (value) => validDocumentDate(value) ? null : t('mdt.invalidDate') }
  })
  const labels = { board_id: t('mdt.board'), mdt_date: t('mdt.date') }
  const selected = choices.find((board) => board.id === form.values.board_id)
  const mutation = useMutation({
    ...createMdtSnapshotMutation(),
    meta: { notificationAction: (error) => normalizeError(error).code === 'blockers'
      ? { labelKey: 'mdt.reviewFindings', onClick: () => { setConfirm(false); showFindings() } }
      : undefined },
    onError: (error) => form.setErrors(apiFieldErrors(error, labels, t)),
    onSuccess: async () => { await refreshCaseResults(client, item.id); setConfirm(false) },
  })
  // Only this request locks the dialog, so it always closes otherwise; a blocked notification keeps its way to the findings.
  const close = () => { if (!mutation.isPending) setConfirm(false) }
  return <Stack gap="sm">
    {boards.isPending && <LoadingState />}
    {boards.isError && <QueryError error={boards.error} retry={() => { void boards.refetch() }} />}
    {boards.isSuccess && !choices.length && <EmptyState title={t('mdt.noBoards')} retry={() => { void boards.refetch() }} />}
    {boards.isSuccess && choices.length > 0 && <form noValidate onSubmit={(event) => { if (busy) { event.preventDefault(); return }; setSubmitted(true); form.onSubmit(() => { mutation.reset(); setConfirm(true) }, (errors) => notifyFormErrors(errors, labels, t, `mdt-snapshot:${item.id}`))(event) }}><Stack gap="sm">
      {submitted && <FormErrorSummary errors={formProblems(form.errors, labels)} />}
      <Text size="sm">{t('mdt.snapshotIntro')}</Text>
      <Group align="flex-start" gap="sm" grow maw={640}>
        <Stack gap={4}>
          <NativeSelect label={t('mdt.board')} data={[{ value: '', label: t('mdt.selectBoard'), disabled: true }, ...choices.map((board) => ({ value: board.id, label: board.name }))]}
            {...form.getInputProps('board_id')} {...pendingControlProps(busy)} />
          <Group><Button variant="subtle" size="compact-sm" px={4} onClick={() => { setSaved(false); setRoster(true) }} pending={busy} disabled={!selected}>{t('mdt.roster')}</Button></Group>
        </Stack>
        <DateInput label={t('mdt.date')} {...form.getInputProps('mdt_date')} {...pendingControlProps(busy)} />
      </Group>
      {saved && <Alert color="green" role="status">{t('mdt.rosterSaved')}</Alert>}
      <Group><Button type="submit" pending={busy}>{t('mdt.snapshot')}</Button></Group>
    </Stack></form>}
    <Modal opened={confirm} onClose={close} title={t('mdt.snapshotTitle')} closeOnEscape={!mutation.isPending} closeOnClickOutside={!mutation.isPending} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(mutation.isPending) }}>
      <Stack><Text>{t('mdt.snapshotHelp')}</Text><Text fw={600}>{selected?.name} · {validDocumentDate(form.values.mdt_date) ? formatDate(form.values.mdt_date, i18n.language) : t('unavailable')}</Text>
        {mutation.isError && <QueryError error={mutation.error} />}
        <Group><Button pending={busy} onClick={() => mutation.mutate({ body: form.values, path: { case_id: item.id }, headers: actorHeaders(actorId) })}>{t('mdt.snapshotConfirm')}</Button><Button variant="default" pending={mutation.isPending} onClick={close}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
    <Modal opened={roster && !!selected} onClose={() => { if (!busy) setRoster(false) }} title={t('mdt.members')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      {roster && selected && <RosterForm key={selected.id} board={selected} actorId={actorId} saved={() => { setRoster(false); setSaved(true) }} />}
    </Modal>
  </Stack>
}
