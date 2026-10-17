import { TextInput, type ElementProps, type TextInputProps } from '@mantine/core'
import { IconCalendar } from '@tabler/icons-react'
import { memo, type Ref } from 'react'
import classes from './DateInput.module.css'

type Props = Omit<TextInputProps, 'type' | 'rightSection'> & ElementProps<'input', keyof TextInputProps> & {
  type?: 'date' | 'datetime-local'; ref?: Ref<HTMLInputElement>;
}

/** Keep a stable calendar icon; the native picker remains the input's interactive control. */
function DateInput({ type = 'date', classNames, ...props }: Props) {
  return <TextInput {...props} type={type} classNames={classNames}
    rightSection={<IconCalendar size={18} aria-hidden data-calendar-icon />}
    rightSectionPointerEvents="none" inputContainer={(children) => <div className={classes.nativePicker}>{children}</div>} />
}

export default memo(DateInput)
