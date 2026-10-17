import { Alert, Button, Group, Paper, Stack, Stepper, Text, Title, VisuallyHidden } from '@mantine/core'
import { IconArrowRight, IconChecks, IconSend } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { mdtStages, stageIndex, type MdtStage } from './mdt-progress'

const stepLabels = { preparation: 'mdt.stepPreparation', snapshot: 'mdt.stepSnapshot', conclusion: 'mdt.stepConclusion', confirm: 'mdt.stepConfirm', send: 'mdt.stepSend' } as const

/** The MDT steps at a glance; read-only, so screen readers get one sentence instead of inert buttons. */
export function MdtProgress({ stage }: { stage: MdtStage }) {
  const { t } = useTranslation(), active = stageIndex(stage)
  return <div>
    <VisuallyHidden>{stage === 'done' ? t('mdt.progressDone') : t('mdt.progressSummary', { current: active + 1, total: mdtStages.length, step: t(stepLabels[stage]) })}</VisuallyHidden>
    <Stepper active={active} size="sm" allowNextStepsSelect={false} aria-hidden iconSize={28}>
      {mdtStages.map((step) => <Stepper.Step key={step} label={t(stepLabels[step])} />)}
    </Stepper>
  </div>
}

const messages = { preparation: 'mdt.nextPreparation', snapshot: 'mdt.nextSnapshot', conclusion: 'mdt.nextConclusion', confirm: 'mdt.nextConfirm', send: 'mdt.nextSend', done: 'mdt.nextDone' } as const

/** One sentence and one primary action for the current stage. */
export default function NextStep({ stage, feedback, disabled, pending, goSnapshot, goConclusion, confirm, goSend }: {
  stage: MdtStage; feedback?: string | null; disabled: boolean; pending: boolean
  goSnapshot: () => void; goConclusion: () => void; confirm: () => void; goSend: () => void;
}) {
  const { t } = useTranslation()
  const action = stage === 'snapshot' ? <Button rightSection={<IconArrowRight size={16} aria-hidden />} onClick={goSnapshot}>{t('mdt.goSnapshot')}</Button>
    : stage === 'conclusion' ? <Button rightSection={<IconArrowRight size={16} aria-hidden />} onClick={goConclusion}>{t('mdt.goConclusion')}</Button>
    : stage === 'confirm' ? <Button leftSection={<IconChecks size={16} aria-hidden />} disabled={disabled || pending} onClick={confirm}>{t('mdt.confirm')}</Button>
    : stage === 'send' ? <Button leftSection={<IconSend size={16} aria-hidden />} onClick={goSend}>{t('mdt.goSend')}</Button>
    : null
  return <Paper component="section" aria-labelledby="mdt-next-step" withBorder p="md" style={{ borderLeft: '4px solid var(--mantine-primary-color-filled)' }}><Stack gap="sm">
    {feedback && <Alert color="green" role="status">{t(feedback)}</Alert>}
    <Group justify="space-between" align="center" gap="sm">
      <Stack gap={2} maw={680}>
        <Title order={2} size="h5" id="mdt-next-step">{t('mdt.nextTitle')}</Title>
        <Text size="sm">{t(messages[stage])}</Text>
      </Stack>
      {action}
    </Group>
  </Stack></Paper>
}
