import { Group, Stack, Text, Timeline, Title } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import {
  IconArrowBackUp, IconArrowsRightLeft, IconCalendarEvent, IconChecklist, IconCircleCheck, IconClipboardText, IconFilePencil,
  IconFilePlus, IconFileUpload, IconHistory, IconListCheck, IconMailForward, IconMessage, IconPencil, IconPlayerPause, IconPlayerPlay,
  IconPlaylistAdd, IconRefresh, IconSend, IconSparkles, IconStethoscope, IconUserCheck, IconUsersGroup, type Icon,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { listAuditOptions } from '../../client/@tanstack/react-query.gen'
import type { AuditEvent } from '../../client/types.gen'
import LoadingState, { EmptyState, QueryError } from '../../components/DataState'
import PersonChip from '../../components/PersonChip'
import { useSession } from '../../session'
import { formatDate, formatDateTime, formatTime, localDateTime } from '../../time'

const actionIcons: Record<string, Icon> = {
  referral_created: IconFilePlus, referral_sent: IconSend, handover_validated: IconCircleCheck, case_returned: IconArrowBackUp,
  document_uploaded: IconFileUpload, document_updated: IconFilePencil, reextraction_started: IconRefresh,
  handover_field_updated: IconClipboardText, examination_added: IconStethoscope, diagnosis_code_from_ai: IconSparkles,
  case_taken_over: IconUserCheck, case_updated: IconPencil, case_transitioned: IconArrowsRightLeft, milestones_updated: IconCalendarEvent,
  hold_set: IconPlayerPause, hold_cleared: IconPlayerPlay, finding_resolved: IconListCheck, finding_requested: IconMailForward,
  task_created: IconPlaylistAdd, task_updated: IconChecklist, task_set_started: IconChecklist,
  mdt_snapshot_created: IconUsersGroup, mdt_record_updated: IconUsersGroup, mdt_conclusion_saved: IconUsersGroup,
  mdt_conclusion_uploaded: IconFileUpload, mdt_conclusion_confirmed: IconCircleCheck,
  feedback_sent: IconSend, receipt_confirmed: IconCircleCheck, patient_notice_sent: IconMessage, patient_notice_created: IconMessage,
}

/** Newest first, grouped by local calendar day (naive datetimes are local, Q-W10). */
function byDay(events: AuditEvent[]) {
  const days = new Map<string, AuditEvent[]>()
  // Reversed before the stable sort, so events with the same timestamp keep newest first too.
  for (const event of [...events].reverse().sort((a, b) => b.at.localeCompare(a.at))) {
    const day = localDateTime(new Date(event.at)).slice(0, 10)
    days.set(day, [...days.get(day) ?? [], event])
  }
  return [...days]
}

export default function AuditTab({ caseId }: { caseId: string }) {
  const { t, i18n } = useTranslation(), { actorId } = useSession()
  const audit = useQuery(listAuditOptions({ path: { case_id: caseId }, headers: actorHeaders(actorId ?? '') }))
  return <Stack component="section" aria-labelledby="audit-heading" gap="md">
    <Title order={2} size="h4" id="audit-heading">{t('workflow.audit')}</Title>
    {audit.isPending && <LoadingState rows={3} />}
    {audit.isError && <QueryError error={audit.error} retry={() => { void audit.refetch() }} />}
    {audit.isSuccess && !audit.data.length && <EmptyState title={t('workflow.noAudit')} />}
    {audit.data && byDay(audit.data).map(([day, events]) => <Stack key={day} component="section" aria-labelledby={`audit-${day}`} gap="xs">
      <Title order={3} size="h6" c="dimmed" id={`audit-${day}`}><time dateTime={day}>{formatDate(day, i18n.language)}</time></Title>
      <Timeline bulletSize={26} lineWidth={2} role="list">
        {events.map((event) => {
          const ActionIcon = actionIcons[event.action] ?? IconHistory
          return <Timeline.Item key={event.id} role="listitem" bullet={<ActionIcon size={14} aria-hidden />} title={
            <Group justify="space-between" gap="xs" wrap="nowrap" align="baseline">
              <Text size="sm" fw={600}>{t(`workflow.actions.${event.action}`, { defaultValue: event.action })}</Text>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}><time dateTime={event.at} title={formatDateTime(event.at, i18n.language)}>{formatTime(event.at, i18n.language)}</time></Text>
            </Group>}>
            <Stack gap={4} mt={4}>
              <PersonChip id={event.actor_id} size="xs" />
              {event.detail && <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{event.detail}</Text>}
            </Stack>
          </Timeline.Item>
        })}
      </Timeline>
    </Stack>)}
  </Stack>
}
