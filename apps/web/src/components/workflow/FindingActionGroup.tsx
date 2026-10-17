import { Button, Group, Tooltip, VisuallyHidden } from '@mantine/core'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { findingActionMeta, findingActions, type FindingAction } from './finding-action-meta'

function ActionButton({ action, disabled, onAction }: { action: FindingAction; disabled?: boolean; onAction: (action: FindingAction) => void }) {
  const { t } = useTranslation(), id = useId()
  const { icon: ActionIcon, label, hint, closes } = findingActionMeta[action]
  return <>
    <Tooltip label={t(hint)} withArrow openDelay={300} events={{ hover: true, focus: true, touch: false }}>
      <Button size="compact-sm" variant={closes ? 'default' : 'filled'} leftSection={<ActionIcon size={14} aria-hidden />}
        disabled={disabled} aria-describedby={id} onClick={() => onAction(action)}>{t(label)}</Button>
    </Tooltip>
    <VisuallyHidden id={id}>{t(hint)}</VisuallyHidden>
  </>
}

// Work actions sit on the left in a fixed order (findingActions), the closing action on the right.
export function FindingActionGroup({ actions = findingActions, disabled, onAction }: {
  actions?: FindingAction[]; disabled?: boolean; onAction: (action: FindingAction) => void
}) {
  const shown = findingActions.filter((action) => actions.includes(action))
  const button = (action: FindingAction) => <ActionButton key={action} action={action} disabled={disabled} onAction={onAction} />
  const work = shown.filter((action) => !findingActionMeta[action].closes), close = shown.filter((action) => findingActionMeta[action].closes)
  return <Group gap="xs" justify="space-between" wrap="wrap">
    <Group gap="xs" wrap="wrap">{work.map(button)}</Group>
    {close.length > 0 && <Group gap="xs" wrap="wrap">{close.map(button)}</Group>}
  </Group>
}
