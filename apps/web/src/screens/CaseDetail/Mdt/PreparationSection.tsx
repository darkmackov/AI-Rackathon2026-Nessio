import { Alert, Button, Paper, SimpleGrid, Stack, Title } from '@mantine/core'
import { useIsMutating } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DraftKind, Handover } from '../../../client/types.gen'
import { EmptyState } from '../../../components/DataState'
import ClinicalValue, { type Sources } from '../../../components/handover/ClinicalValue'
import HandoverFieldForm from '../../../components/handover/HandoverFieldForm'
import DraftAssist from './DraftAssist'

type Path = 'epicrisis' | 'mdt_question'
const labels = { epicrisis: 'mdt.finalEpicrisis', mdt_question: 'mdt.question' } satisfies Record<Path, string>
const drafts = { epicrisis: 'epicrisis_summary', mdt_question: 'mdt_question' } satisfies Record<Path, DraftKind>
const focusEditor = (node: HTMLHeadingElement | null) => { node?.focus() }

/** One handover field edited in place; using a draft remounts the form with its text (WEB-10). */
function FieldEditor({ caseId, actorId, path, handover, close, saved }: { caseId: string; actorId: string; path: Path; handover: Handover; close: () => void; saved: () => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<{ version: number; text: string } | null>(null)
  return <Paper component="section" aria-label={t(labels[path])} withBorder p="sm" shadow="xs"><Stack gap="sm">
    <Title order={3} size="h5" tabIndex={-1} ref={focusEditor}>{t(labels[path])}</Title>
    <DraftAssist caseId={caseId} actorId={actorId} kind={drafts[path]} onUse={(value) => setDraft((current) => ({ version: (current?.version ?? 0) + 1, text: value.text ?? '' }))} />
    <HandoverFieldForm key={draft?.version ?? 0} caseId={caseId} actorId={actorId} path={path} value={handover[path]} initialText={draft?.text} close={close} saved={saved} />
  </Stack></Paper>
}

export default function PreparationSection({ caseId, actorId, handover, handoverState, names, sources, showFindings, locked }: {
  caseId: string; actorId: string; handover?: Handover; handoverState?: ReactNode; names: Record<string, string>; sources: Sources; showFindings: () => void; locked: boolean;
}) {
  const { t } = useTranslation(), busy = useIsMutating() > 0
  const [editing, setEditing] = useState<Path | null>(null), [returnTo, setReturnTo] = useState<Path | null>(null), [saved, setSaved] = useState(false)
  if (!handover) return <>{handoverState ?? <EmptyState title={t('caseDetail.noHandover')} />}</>
  const done = (path: Path, changed: boolean) => { setEditing(null); setReturnTo(path); setSaved(changed) }
  const field = (path: Path) => editing === path
    ? <FieldEditor caseId={caseId} actorId={actorId} path={path} handover={handover} close={() => done(path, false)} saved={() => done(path, true)} />
    : <ClinicalValue idPrefix="mdt-field" label={t(labels[path])} path={path} value={handover[path]} names={names} sources={sources} findings={[]} showFinding={showFindings} focused={returnTo === path}
      actions={<Button variant="outline" size="compact-sm" disabled={busy || locked || editing !== null} onClick={() => { setSaved(false); setEditing(path) }}>{t('mdt.edit')}</Button>} />
  return <Stack gap="sm">
    {saved && <Alert color="green" role="status">{t('mdt.saved')}</Alert>}
    <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
      <ClinicalValue idPrefix="mdt-field" label={t('mdt.sourceEpicrisis')} path="epicrisis_source" value={handover.epicrisis_source} names={names} sources={sources} findings={[]} showFinding={showFindings} />
      {field('epicrisis')}
    </SimpleGrid>
    {field('mdt_question')}
  </Stack>
}
