import Button from '../../../components/ActionButton'
import { Alert, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { useIsMutating } from '@tanstack/react-query'
import { IconPencil } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Case, MdtRecord, MdtResultRow } from '../../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../../components/DataState'
import DraftAssist from './DraftAssist'
import type { Loaded } from './loaded'
import PdfDownload from './PdfDownload'
import RecordEditor from './RecordEditor'
import RecordView from './RecordView'
import SnapshotForm from './SnapshotForm'
import { snapshotStates } from './mdt-progress'

const focusEditor = (node: HTMLHeadingElement | null) => { node?.focus() }

export default function RecordSection({ item, actorId, record, retry, editable, showFindings }: {
  item: Case; actorId: string; record: Loaded<MdtRecord>; retry: () => void; editable: boolean; showFindings: () => void;
}) {
  const { t } = useTranslation(), busy = useIsMutating() > 0
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState<{ version: number; rows: MdtResultRow[] } | null>(null), [saved, setSaved] = useState(false)
  const close = (changed: boolean) => { setEditing(false); setDraft(null); setSaved(changed) }
  if (record.kind === 'loading') return <LoadingState rows={3} />
  if (record.kind === 'error') return <QueryError error={record.error} retry={retry} />
  if (record.kind === 'missing') return item.state && snapshotStates.includes(item.state) ? <SnapshotForm item={item} actorId={actorId} showFindings={showFindings} /> : <EmptyState title={t('mdt.noRecord')} description={t('mdt.notComplete')} />
  return <Stack gap="sm">
    {saved && <Alert color="green" role="status">{t('mdt.saved')}</Alert>}
    {editing
      ? <Paper component="section" aria-label={t('mdt.editRecord')} withBorder p="sm" shadow="xs"><Stack gap="sm">
        <Title order={3} size="h5" tabIndex={-1} ref={focusEditor}>{t('mdt.editRecord')}</Title>
        <DraftAssist caseId={item.id} actorId={actorId} kind="mdt_results" help={t('mdt.resultsDraftHelp')} onUse={(value) => setDraft((current) => ({ version: (current?.version ?? 0) + 1, rows: value.rows ?? [] }))} />
        <RecordEditor key={draft?.version ?? 0} record={record.data} rows={draft?.rows} actorId={actorId} close={() => close(false)} saved={() => close(true)} />
      </Stack></Paper>
      : <>
        <Stack gap={4}>
          <Group gap="xs" align="flex-start">
            {editable && <Button variant="outline" size="compact-sm" leftSection={<IconPencil size={14} aria-hidden />} pending={busy} onClick={() => { setSaved(false); setEditing(true) }}>{t('mdt.editRecord')}</Button>}
            <PdfDownload caseId={item.id} actorId={actorId} kind="record" />
          </Group>
          {editable && <Text size="sm" c="dimmed">{t('mdt.recordEditHelp')}</Text>}
        </Stack>
        <RecordView record={record.data} />
      </>}
  </Stack>
}
