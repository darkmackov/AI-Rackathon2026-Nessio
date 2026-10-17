import { pendingControlProps } from '../../components/pending-control'
import Button from '../../components/ActionButton'
import { Group, Modal, Stack, Text } from '@mantine/core'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../../api'
import { getCaseQueryKey, getHandoverQueryKey, sendReferralMutation, validateHandoverMutation } from '../../client/@tanstack/react-query.gen'
import { QueryError } from '../../components/DataState'
import { refreshCaseResults } from '../../components/documents/use-document-ingest'

export default function SendReferral({ caseId, actorId, koc, disabled, sent }: { caseId: string; actorId: string; koc: string; disabled: boolean; sent: (returned: boolean) => void }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [opened, setOpened] = useState(false)
  const [stage, setStage] = useState<'validate' | 'send'>('validate')
  const busy = useIsMutating() > 0
  const send = useMutation(sendReferralMutation())
  const options = { path: { case_id: caseId }, headers: actorHeaders(actorId) }
  const validate = useMutation({
    ...validateHandoverMutation(),
    // Keep this mutation pending through sending and refresh so the shared identity lock covers the whole action.
    onSuccess: async (handover) => {
      client.setQueryData(getHandoverQueryKey(options), handover)
      setStage('send')
      const item = await send.mutateAsync(options)
      client.setQueryData(getCaseQueryKey(options), item)
      setOpened(false)
      sent(item.state === 'v_triage')
    },
    // Reload even after a lost response. Never silently retry a send.
    onSettled: () => refreshCaseResults(client, caseId),
  })
  const submit = () => {
    if (busy || disabled) return
    setStage('validate')
    validate.reset(); send.reset()
    validate.mutate(options)
  }
  const error = stage === 'validate' ? validate.error : send.error
  return <>
    <Button onClick={() => { validate.reset(); send.reset(); setOpened(true) }} pending={busy} disabled={disabled}>{t('referral.send')}</Button>
    <Modal opened={opened} onClose={() => { if (!busy) setOpened(false) }} title={t('referral.confirmTitle')} closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      <Stack>
        <Text>{t('referral.confirmText', { koc })}</Text>
        {error && <Stack gap="xs"><Text fw={600} size="sm">{t(stage === 'validate' ? 'referral.validateError' : 'referral.sendError')}</Text><QueryError error={error} /></Stack>}
        <Group><Button onClick={submit} pending={busy || validate.isPending} disabled={disabled}>{t('referral.send')}</Button><Button variant="default" onClick={() => setOpened(false)} pending={busy}>{t('cancel')}</Button></Group>
      </Stack>
    </Modal>
  </>
}
