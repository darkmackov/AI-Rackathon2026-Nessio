import { IconCircleCheck, IconPencil, IconSend, type Icon } from '@tabler/icons-react'

export type FindingAction = 'fill' | 'request' | 'resolve'

// One mapping for every finding action: order, icon, label, dialog title, hint,
// and whether it closes the finding (shown apart on the right as a neutral outline).
export const findingActions: FindingAction[] = ['fill', 'request', 'resolve']
export const findingActionMeta: Record<FindingAction, { icon: Icon; label: string; title: string; hint: string; closes?: boolean }> = {
  fill: { icon: IconPencil, label: 'caseDetail.fill', title: 'caseDetail.fill', hint: 'workflow.fillHint' },
  request: { icon: IconSend, label: 'caseDetail.request', title: 'caseDetail.request', hint: 'workflow.requestHint' },
  resolve: { icon: IconCircleCheck, label: 'workflow.closeFinding', title: 'workflow.closeFinding', hint: 'workflow.closeHint', closes: true },
}
