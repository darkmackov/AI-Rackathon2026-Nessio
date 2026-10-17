import Button from '../ActionButton'
import { Group, Modal, Stack, Text } from '@mantine/core'
import { IconCircleCheck } from '@tabler/icons-react'
import { useIsMutating, useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listCaseJobsOptions } from '../../client/@tanstack/react-query.gen'
import type { DocumentMeta } from '../../client/types.gen'
import { QueryError } from '../DataState'
import { terminalJob } from './document-utils'
import { pendingControlProps } from '../pending-control'
import JobProgress from './JobProgress'
import NessieGameDialog, { NessieGameButton } from '../nessie-game/NessieGameDialog'
import { useReextract } from './use-document-ingest'

function useIngestJobs(caseId: string, actorId: string) {
  const options = { headers: actorHeaders(actorId), path: { case_id: caseId } }
  const jobs = useQuery(listCaseJobsOptions(options))
  return { jobs, options, ingestJobs: jobs.data?.filter((job) => job.kind === 'ingest_document') ?? [] }
}

/** Job rows with the game offered at the end of the first row while something still runs; it wraps below on narrow screens. */
export function JobsWithGame({ jobs, running, play }: { jobs: ReactNode; running: boolean; play: () => void }) {
  return <Group justify="space-between" align="flex-start" gap="xs" wrap="wrap">
    <Stack gap={6} miw={0} style={{ flex: '1 1 16rem' }}>{jobs}</Stack>
    {running && <NessieGameButton onClick={play} />}
  </Group>
}

// Each running job polls itself (WEB-19). Jobs finished before this view opened fold into one summary line;
// jobs seen running here stay listed so their outcome is visible where the user is looking.
export default function DocumentJobs({ caseId, actorId, documents }: { caseId: string; actorId: string; documents: DocumentMeta[] }) {
  const { t } = useTranslation()
  const { jobs, ingestJobs } = useIngestJobs(caseId, actorId)
  const [followed, setFollowed] = useState<string[]>([])
  const unseen = ingestJobs.filter((job) => !terminalJob(job) && !followed.includes(job.id)).map((job) => job.id)
  if (unseen.length) setFollowed([...followed, ...unseen])
  const shown = ingestJobs.filter((job) => job.status !== 'done' || followed.includes(job.id) || unseen.includes(job.id))
  const finished = ingestJobs.length - shown.length
  const running = ingestJobs.some((job) => !terminalJob(job))
  const [playing, setPlaying] = useState(false)
  if (!jobs.isError && !ingestJobs.length) return null
  return <Stack gap={6} aria-label={t('documents.processing')} role="group">
    {jobs.isError && <QueryError error={jobs.error} pending={jobs.isFetching} retry={() => { void jobs.refetch() }} />}
    {shown.length > 0 && <JobsWithGame jobs={shown.map((job) => <JobProgress key={job.id} job={job} actorId={actorId} documents={documents} />)}
      running={running} play={() => setPlaying(true)} />}
    {finished > 0 && <Group gap={6}><IconCircleCheck size={16} color="var(--mantine-color-green-8)" aria-hidden /><Text size="sm" c="dimmed">{t('documents.processedCount', { count: finished })}</Text></Group>}
    <NessieGameDialog caseId={caseId} actorId={actorId} opened={playing} onClose={() => setPlaying(false)} />
  </Stack>
}

// Re-extraction can reopen findings people closed (their ids may change), so it asks first.
export function ReextractButton({ caseId, actorId, documents }: { caseId: string; actorId: string; documents: DocumentMeta[] }) {
  const { t } = useTranslation()
  const busy = useIsMutating() > 0
  const { options, ingestJobs } = useIngestJobs(caseId, actorId)
  const reextract = useReextract(caseId, actorId)
  const processing = ingestJobs.some((job) => !terminalJob(job))
  const [opened, setOpened] = useState(false)
  const confirm = () => reextract.mutate(options, { onSettled: () => setOpened(false) })
  return <>
    <Button variant="outline" size="xs" onClick={() => setOpened(true)} pending={busy || processing || reextract.isPending} disabled={!documents.length}>{t('documents.reextract')}</Button>
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false) }} title={t('documents.reextractTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      <Stack>
        <Text>{t('documents.reextractText')}</Text>
        <Group><Button onClick={confirm} pending={busy || reextract.isPending}>{t('documents.reextract')}</Button><Button variant="default" onClick={() => setOpened(false)} pending={busy}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
  </>
}
