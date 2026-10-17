import { ActionIcon, type ActionIconProps, type ElementProps } from '@mantine/core'
import type { Ref } from 'react'
import { pendingControlProps } from './pending-control'
import classes from './PendingControl.module.css'

type Props = Omit<ActionIconProps, 'loading'> & ElementProps<'button', keyof ActionIconProps> & { pending?: boolean; ref?: Ref<HTMLButtonElement> }

export default function ActionIconButton({ pending = false, disabled = false, className, ...props }: Props) {
  return <ActionIcon {...props} {...pendingControlProps(pending, disabled)} loading={false}
    className={[classes.icon, className].filter(Boolean).join(' ')} />
}
