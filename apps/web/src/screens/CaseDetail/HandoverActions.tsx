import { Modal, Stack, Text } from '@mantine/core'
import { useIsMutating } from '@tanstack/react-query'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Finding, Handover } from '../../client/types.gen'
import { FindingActionGroup } from '../../components/workflow/FindingActionGroup'
import { FieldEditor } from './FindingActions'
import TaskEditor from './TaskEditor'

const Actions = createContext<{ fill: (path: string) => void; request: (label: string) => void } | null>(null)
export function FieldActions({ path, label, findings, showFinding }: { path: string; label: string; findings: Finding[]; showFinding: (id: string) => void }) {
  const actions = useContext(Actions), busy = useIsMutating() > 0
  return <FindingActionGroup actions={['fill', 'request']} disabled={!actions || busy}
    onAction={(action) => action === 'fill' ? actions?.fill(path) : findings[0] ? showFinding(findings[0].id) : actions?.request(label)} />
}
export default function HandoverActions({ caseId, handover, children }: { caseId: string; handover: Handover; children: ReactNode }) {
  const [path, setPath] = useState<string | null>(null), [request, setRequest] = useState<string | null>(null), [saved, setSaved] = useState(false)
  const busy = useIsMutating() > 0, { t } = useTranslation()
  const close = () => { setPath(null); setRequest(null) }
  const success = () => { close(); setSaved(true) }
  return <Actions.Provider value={{ fill: (path) => { setSaved(false); setPath(path) }, request: (label) => { setSaved(false); setRequest(label) } }}>
    <Stack gap="sm">{saved && <Text size="sm" role="status">{t('workflow.saved')}</Text>}{children}</Stack>
    <Modal opened={!!path || !!request} onClose={() => { if (!busy) close() }} title={t(path ? 'caseDetail.fill' : 'caseDetail.request')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), disabled: busy }}>
      {path && <FieldEditor key={path} caseId={caseId} handover={handover} paths={[path]} onSaved={success} onClose={close} />}
      {request && <TaskEditor caseId={caseId} initialTitle={request} initialKind="request_documents" onSaved={success} />}
    </Modal>
  </Actions.Provider>
}
