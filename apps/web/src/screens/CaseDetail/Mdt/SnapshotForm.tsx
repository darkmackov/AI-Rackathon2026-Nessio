import { Alert, Button, Group, Modal, NativeSelect, Stack, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, actorHeaders } from '../../../api'
import { createMdtSnapshotMutation, getMdtBoardQueryKey, listMdtBoardsOptions, listMdtBoardsQueryKey, updateMdtBoardMembersMutation } from '../../../client/@tanstack/react-query.gen'
import type { Case, MdtBoard, MdtBoardMembersUpdate, MdtSnapshotCreate } from '../../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../../components/DataState'
import FormErrorSummary from '../../../components/FormErrorSummary'
import { validDocumentDate } from '../../../components/documents/document-utils'
import { refreshCaseResults } from '../../../components/documents/use-document-ingest'
import { formatDate } from '../../../time'
import MembersInput from './MembersInput'

function RosterForm({ board, actorId, saved }: { board: MdtBoard; actorId: string; saved: () => void }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false)
  const form = useForm<MdtBoardMembersUpdate>({ initialValues: { members: structuredClone(board.members ?? []) }, validate: { members: (value) => value.some((member) => !member.name.trim() || !member.specialty.trim()) ? t('mdt.required') : null } })
  const mutation = useMutation({ ...updateMdtBoardMembersMutation(), onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: listMdtBoardsQueryKey() }), client.invalidateQueries({ queryKey: getMdtBoardQueryKey({ path: { board_id: board.id } }) })]); saved()
  } })
  return <form noValidate onSubmit={(event) => { if (busy) { event.preventDefault(); return }; setSubmitted(true); form.onSubmit((body) => mutation.mutate({ body, path: { board_id: board.id }, headers: actorHeaders(actorId) }))(event) }}><Stack>
    <Text size="sm">{t('mdt.rosterHelp')}</Text>
    {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={[t('mdt.required')]} />}
    <MembersInput value={form.values.members} onChange={(value) => form.setFieldValue('members', value)} />
    {mutation.isError && <QueryError error={mutation.error} />}
    <Button type="submit" loading={mutation.isPending} disabled={busy}>{t('mdt.save')}</Button>
  </Stack></form>
}

export default function SnapshotForm({ item, actorId, showFindings }: { item: Case; actorId: string; showFindings: () => void }) {
  const { t, i18n } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [submitted, setSubmitted] = useState(false), [confirm, setConfirm] = useState(false), [roster, setRoster] = useState(false), [saved, setSaved] = useState(false)
  const boards = useQuery(listMdtBoardsOptions({ headers: actorHeaders(actorId) }))
  const choices = boards.data?.filter((board) => board.organization_id === item.koc_id) ?? []
  const form = useForm<MdtSnapshotCreate>({ initialValues: { board_id: item.mdt_board_id ?? '', mdt_date: item.mdt_date ?? '' }, validateInputOnBlur: true,
    validate: { board_id: (id) => choices.some((board) => board.id === id) ? null : 'mdt.required', mdt_date: (value) => validDocumentDate(value) ? null : 'mdt.invalidDate' } })
  const selected = choices.find((board) => board.id === form.values.board_id)
  const mutation = useMutation({ ...createMdtSnapshotMutation(), onSuccess: async () => { await refreshCaseResults(client, item.id); setConfirm(false) } })
  // Only this request locks the dialog, so it always closes otherwise; a blocked notice stays below the form with its way to the findings.
  const close = () => { if (!mutation.isPending) setConfirm(false) }
  const blocked = mutation.error instanceof ApiError && mutation.error.status === 409
  const blockedNotice = blocked && <Alert role="alert" color="orange"><Stack gap="xs"><Text size="sm">{t('mdt.snapshotBlocked')}</Text><Group><Button variant="outline" onClick={() => { setConfirm(false); showFindings() }}>{t('mdt.reviewFindings')}</Button></Group></Stack></Alert>
  return <Stack gap="sm">
    {boards.isPending && <LoadingState />}
    {boards.isError && <QueryError error={boards.error} retry={() => { void boards.refetch() }} />}
    {boards.isSuccess && !choices.length && <EmptyState title={t('mdt.noBoards')} retry={() => { void boards.refetch() }} />}
    {boards.isSuccess && choices.length > 0 && <form noValidate onSubmit={(event) => { if (busy) { event.preventDefault(); return }; setSubmitted(true); form.onSubmit(() => { mutation.reset(); setConfirm(true) })(event) }}><Stack gap="sm">
      {submitted && Object.keys(form.errors).length > 0 && <FormErrorSummary errors={Object.values(form.errors).map((value) => t(String(value)))} />}
      <Text size="sm">{t('mdt.snapshotIntro')}</Text>
      <Group align="flex-start" gap="sm" grow maw={640}>
        <Stack gap={4}>
          <NativeSelect label={t('mdt.board')} data={[{ value: '', label: t('mdt.selectBoard'), disabled: true }, ...choices.map((board) => ({ value: board.id, label: board.name }))]}
            {...form.getInputProps('board_id')} error={form.errors.board_id ? t('mdt.required') : undefined} disabled={busy} />
          <Group><Button variant="subtle" size="compact-sm" px={4} onClick={() => { setSaved(false); setRoster(true) }} disabled={!selected || busy}>{t('mdt.roster')}</Button></Group>
        </Stack>
        <TextInput type="date" label={t('mdt.date')} {...form.getInputProps('mdt_date')} error={form.errors.mdt_date ? t('mdt.invalidDate') : undefined} disabled={busy} />
      </Group>
      {saved && <Alert color="green" role="status">{t('mdt.rosterSaved')}</Alert>}
      <Group><Button type="submit" disabled={busy}>{t('mdt.snapshot')}</Button></Group>
    </Stack></form>}
    {!confirm && blockedNotice}
    <Modal opened={confirm} onClose={close} title={t('mdt.snapshotTitle')} closeOnEscape={!mutation.isPending} closeOnClickOutside={!mutation.isPending} closeButtonProps={{ 'aria-label': t('close'), disabled: mutation.isPending }}>
      <Stack><Text>{t('mdt.snapshotHelp')}</Text><Text fw={600}>{selected?.name} · {formatDate(form.values.mdt_date, i18n.language)}</Text>
        {blockedNotice}{mutation.isError && !blocked && <QueryError error={mutation.error} />}
        <Group><Button loading={mutation.isPending} disabled={busy} onClick={() => mutation.mutate({ body: form.values, path: { case_id: item.id }, headers: actorHeaders(actorId) })}>{t('mdt.snapshotConfirm')}</Button><Button variant="default" disabled={mutation.isPending} onClick={close}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
    <Modal opened={roster && !!selected} onClose={() => { if (!busy) setRoster(false) }} title={t('mdt.members')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {roster && selected && <RosterForm key={selected.id} board={selected} actorId={actorId} saved={() => { setRoster(false); setSaved(true) }} />}
    </Modal>
  </Stack>
}
