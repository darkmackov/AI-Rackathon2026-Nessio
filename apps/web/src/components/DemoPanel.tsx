import DateInput from './DateInput'
import Button from './ActionButton'
import { pendingControlProps } from './pending-control'
import { Alert, Divider, Drawer, Group, Modal, Stack, Text, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { actorHeaders } from '../api'
import { apiMode } from '../config'
import { getDemoClockQueryKey, listCasesQueryKey, listActorsQueryKey, listOrganizationsQueryKey, listMdtBoardsQueryKey, resetDemoMutation, setDemoClockMutation } from '../client/@tanstack/react-query.gen'
import type { DemoScenario } from '../client/types.gen'
import { roleHome, useSession } from '../session'
import { validLocalDateTime } from '../time'
import DemoClock from './DemoClock'
import { useDemoClock } from '../demo-clock'
import { QueryError } from './DataState'
import FormErrorSummary from './FormErrorSummary'
import { isCaseQuery } from '../case-queries'
import { clearNotifications } from '../notifications/notify'
import { apiFieldErrors, formProblems, notifyFormErrors } from '../notifications/form-validation'

function TimeForm({ initialNow, onStart, onSaved }: { initialNow: string; onStart: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { actorId } = useSession()
  const busy = useIsMutating() > 0
  const id = useId()
  const [failedSubmits, setFailedSubmits] = useState(0)
  const labels = { now: t('dateTime') }
  const form = useForm({
    initialValues: { now: initialNow.slice(0, 19) },
    validateInputOnBlur: true,
    validate: { now: (value) => validLocalDateTime(value) ? null : t('invalidDateTime') },
  })
  const change = useMutation({
    ...setDemoClockMutation(),
    onError: (error) => {
      const errors = apiFieldErrors(error, labels, t)
      if (Object.keys(errors).length) {
        form.setErrors({ ...form.errors, ...errors })
        setFailedSubmits((count) => count + 1)
      }
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: getDemoClockQueryKey() })
      await queryClient.invalidateQueries({ queryKey: getDemoClockQueryKey() })
      // Other time-sensitive queries must also observe the newly selected server time.
      await queryClient.invalidateQueries({ queryKey: listCasesQueryKey() })
      await queryClient.cancelQueries({ predicate: isCaseQuery })
      await queryClient.invalidateQueries({ predicate: isCaseQuery })
      onSaved()
    },
  })

  return <form noValidate onSubmit={(event) => {
    if (busy) { event.preventDefault(); return }
    form.onSubmit((values) => {
      onStart()
      change.mutate({ body: { now: values.now }, headers: actorHeaders(actorId ?? '') })
    }, (errors) => {
      setFailedSubmits((count) => count + 1)
      notifyFormErrors(errors, labels, t, id)
    })(event)
  }}>
    <Stack>
      {failedSubmits > 0 && <FormErrorSummary errors={formProblems(form.errors, labels)} focusKey={failedSubmits} />}
      <DateInput type="datetime-local" step={1} label={t('dateTime')} {...pendingControlProps(busy)}
        {...form.getInputProps('now')} />
      <Group>
        <Button type="submit" pending={busy || change.isPending}>{t('applyTime')}</Button>
        <Button variant="outline" pending={busy} onClick={() => { onStart(); change.mutate({ body: { now: null }, headers: actorHeaders(actorId ?? '') }) }}>{t('wallClockAction')}</Button>
      </Group>
    </Stack>
  </form>
}

export default function DemoPanel({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const { actor, actorId } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const clock = useDemoClock()
  const busy = useIsMutating() > 0
  const [scenario, setScenario] = useState<DemoScenario | null>(null)
  const [feedback, setFeedback] = useState<'timeSaved' | 'resetSaved' | null>(null)
  const [formRevision, setFormRevision] = useState(0)
  const reset = useMutation({
    ...resetDemoMutation(),
    onSuccess: async () => {
      clearNotifications()
      await queryClient.cancelQueries()
      if (actor) await navigate({ to: roleHome(actor.role), replace: true })
      // A reset discards case documents, jobs and results as well as the queue.
      queryClient.removeQueries({ predicate: isCaseQuery })
      // These generated keys deliberately omit filters and cover all cached variants.
      await Promise.all([
        listCasesQueryKey(), getDemoClockQueryKey(), listActorsQueryKey(),
        listOrganizationsQueryKey(), listMdtBoardsQueryKey(),
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      // A single-board key requires its id; cover every cached roster without constructing a custom key.
      await queryClient.invalidateQueries({ predicate: (query) => { const key = query.queryKey[0]; return !!key && typeof key === 'object' && '_id' in key && key._id === 'getMdtBoard' } })
      setScenario(null)
      setFeedback('resetSaved')
      setFormRevision((revision) => revision + 1)
    },
  })
  const scenarioName = scenario === 'empty' ? t('emptyScenario') : t('referenceScenario')

  return <Drawer opened={opened} onClose={() => { if (!busy) { setFeedback(null); onClose() } }}
    position="right" size="lg" title={t('demoTitle')} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}
    closeOnEscape={!busy} closeOnClickOutside={!busy}>
    <Stack gap="lg">
      <Alert role="note" color={apiMode === 'mock' ? 'blue' : 'gray'} title={t(apiMode === 'mock' ? 'demoData' : 'realApi')}>
        {apiMode === 'mock' && <Text size="sm">{t('documents.demoHelp')}</Text>}
      </Alert>
      <DemoClock />
      <Text size="sm" c="dimmed">{t('computerTime', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</Text>
      {feedback && <Alert color="green" role="status">{t(feedback)}</Alert>}
      {clock.data && <TimeForm key={formRevision} initialNow={clock.data.now} onStart={() => setFeedback(null)} onSaved={() => setFeedback('timeSaved')} />}
      <Divider />
      <div><Title order={2} size="h4">{t('resetHeading')}</Title><Text size="sm" c="dimmed" mt="xs">{t('resetHelp')}</Text></div>
      <Group>
        <Button variant="outline" pending={busy} onClick={() => { reset.reset(); setScenario('reference_at_mdt') }}>{t('resetReference')}</Button>
        <Button variant="outline" color="red" pending={busy} onClick={() => { reset.reset(); setScenario('empty') }}>{t('resetEmpty')}</Button>
      </Group>
    </Stack>
    <Modal opened={scenario !== null} onClose={() => { if (!busy) setScenario(null) }} title={t('confirmReset')}
      centered closeOnEscape={!busy} closeOnClickOutside={!busy} closeButtonProps={{ 'aria-label': t('close'), ...pendingControlProps(busy) }}>
      <Stack>
        <Text>{t('confirmResetText', { scenario: scenarioName })}</Text>
        {reset.isError && <QueryError error={reset.error} />}
        <Group justify="flex-end">
          <Button variant="default" pending={busy} onClick={() => setScenario(null)}>{t('cancel')}</Button>
          <Button color="red" pending={busy || reset.isPending} onClick={() => {
            if (scenario) { setFeedback(null); reset.mutate({ body: { scenario }, headers: actorHeaders(actorId ?? '') }) }
          }}>{t('resetConfirm')}</Button>
        </Group>
      </Stack>
    </Modal>
  </Drawer>
}
