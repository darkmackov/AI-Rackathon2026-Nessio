import Button from '../../../components/ActionButton'
import { Badge, Group, Paper, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../../api'
import { getHandoverQueryKey, listCodeCandidatesOptions, pickDiagnosisCodeMutation } from '../../../client/@tanstack/react-query.gen'
import type { Handover } from '../../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../../components/DataState'
import { refreshCaseResults } from '../../../components/documents/use-document-ingest'
import { normalizeError } from '../../../notifications/normalize-error'
import { useSession } from '../../../session'

function Candidates({ caseId, actorId, saved }: { caseId: string; actorId: string; saved: () => void }) {
  const { t } = useTranslation(), client = useQueryClient(), busy = useIsMutating() > 0
  const [requested, setRequested] = useState(false)
  const options = { path: { case_id: caseId }, headers: actorHeaders(actorId) }
  const candidates = useQuery({ ...listCodeCandidatesOptions(options), enabled: requested })
  const pick = useMutation({
    ...pickDiagnosisCodeMutation(), onSuccess: async (handover) => {
      saved()
      client.setQueryData(getHandoverQueryKey(options), handover)
      await refreshCaseResults(client, caseId)
    }
  })
  const stale = [candidates.error, pick.error].some((error) => ['staleCodes', 'codeExists'].includes(normalizeError(error).code))
  return <Stack gap="xs">
    <Group><Button variant="subtle" size="compact-sm" pending={busy || candidates.isFetching}  onClick={() => {
      setRequested(true)
      if (requested) { pick.reset(); void candidates.refetch() }
    }}>{t('s8.suggest')}</Button></Group>
    {requested && <Paper withBorder p="xs"><Stack gap="xs">
      <Text size="sm" fw={600}>{t('s8.candidates')}</Text>
      <Text size="xs" c="dimmed">{t('s8.candidateHelp')}</Text>
      {candidates.isPending && <LoadingState />}
      {stale ? <Button size="compact-sm" variant="outline" onClick={() => { pick.reset(); void refreshCaseResults(client, caseId) }}>{t('s8.refresh')}</Button>
        : <>{candidates.isError && <QueryError error={candidates.error} retry={() => { void candidates.refetch() }} />}{pick.isError && <QueryError error={pick.error} />}</>}
      {candidates.isSuccess && !stale && !candidates.data.length && <EmptyState title={t('s8.noCandidates')} />}
      {candidates.isSuccess && !stale && candidates.data.map((candidate) => <Paper withBorder p="xs" key={candidate.code}>
        <Stack gap={6}><Group gap="xs"><Text fw={600} size="sm">{candidate.code}</Text><Badge size="xs" color="violet" variant="light">{t('caseDetail.ai')}</Badge></Group>
          <Text size="sm">{candidate.title_cs}</Text>
          <Group><Button size="compact-sm" variant="outline" pending={busy || candidates.isFetching || pick.isPending && pick.variables?.body.code === candidate.code}
            onClick={() => pick.mutate({ ...options, body: { code: candidate.code } })}>{t('s8.useCode', { code: candidate.code })}</Button></Group>
        </Stack>
      </Paper>)}
    </Stack></Paper>}
  </Stack>
}

export default function CodeCandidates({ handover, onSaved }: { handover: Handover; onSaved: () => void }) {
  const { actorId } = useSession(), { t } = useTranslation()
  const [saved, setSaved] = useState(false)
  const eligible = !!handover.diagnosis?.value?.trim() && handover.diagnosis_code?.value == null
  return <>
    {saved && <Text role="status" size="sm">{t('s8.saved')}</Text>}
    {eligible && <Candidates key={`${actorId}:${handover.case_id}:${handover.diagnosis?.value}`} caseId={handover.case_id} actorId={actorId ?? ''} saved={() => { setSaved(true); onSaved() }} />}
  </>
}
