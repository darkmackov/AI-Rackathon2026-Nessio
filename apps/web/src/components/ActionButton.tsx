import { Button, type ButtonProps, type ElementProps } from '@mantine/core'
import type { Ref } from 'react'
import { pendingControlProps } from './pending-control'
import classes from './PendingControl.module.css'

type Props = Omit<ButtonProps, 'loading'> & ElementProps<'button', keyof ButtonProps> & { pending?: boolean; ref?: Ref<HTMLButtonElement> }

/** Keep the same Mantine label, icon and dimensions throughout an operation. */
export default function ActionButton({ pending = false, disabled = false, className, ...props }: Props) {
  return <Button {...props} {...pendingControlProps(pending, disabled)} loading={false}
    className={[classes.button, className].filter(Boolean).join(' ')} />
}
