import { Group, Image, Loader, Modal, Stack, Text } from '@mantine/core'
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listCaseJobsOptions } from '../../client/@tanstack/react-query.gen'
import Button from '../ActionButton'
import { terminalJob } from '../documents/document-utils'
import NessieGame from './NessieGame'

/** A quiet inline action placed next to a running document job. */
export function NessieGameButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return <Button variant="subtle" size="compact-sm" onClick={onClick}
    leftSection={<Image src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" aria-hidden w={16} h={18} fit="contain" />}>
    {t('nessieGame.open')}
  </Button>
}

/**
 * The game dialog. It reads the same jobs query the job list polls (WEB-19). Render it where it stays mounted
 * while jobs finish, so the game outlives the processing it was opened for.
 */
export default function NessieGameDialog({ caseId, actorId, opened, onClose }: { caseId: string; actorId: string; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const jobs = useQuery(listCaseJobsOptions({ headers: actorHeaders(actorId), path: { case_id: caseId } }))
  const ingest = jobs.data?.filter((job) => job.kind === 'ingest_document') ?? []
  const running = ingest.filter((job) => !terminalJob(job))
  const [followed, setFollowed] = useState<string[]>([])
  const unseen = opened ? running.filter((job) => !followed.includes(job.id)).map((job) => job.id) : []
  if (unseen.length) setFollowed([...followed, ...unseen])
  const failed = ingest.some((job) => followed.includes(job.id) && job.status === 'failed')
  return <Modal opened={opened} onClose={onClose} title={t('nessieGame.title')} size="lg" closeButtonProps={{ 'aria-label': t('close') }}>
    <Stack gap="md">
      <Group role="status" gap="xs" justify="space-between" wrap="wrap" mih={30}>
        {running.length
          ? <Group gap="xs" wrap="nowrap"><Loader size="xs" /><Text size="sm">{t('nessieGame.processing', { count: running.length })}</Text></Group>
          : <Group gap="xs" wrap="nowrap">
            {failed ? <IconAlertTriangle size={18} color="var(--mantine-color-orange-8)" aria-hidden /> : <IconCircleCheck size={18} color="var(--mantine-color-green-8)" aria-hidden />}
            <Text size="sm" fw={600}>{t(failed ? 'nessieGame.failed' : 'nessieGame.done')}</Text>
          </Group>}
        {!running.length && <Button size="xs" onClick={onClose}>{t('nessieGame.back')}</Button>}
      </Group>
      {opened && <NessieGame />}
    </Stack>
  </Modal>
}
