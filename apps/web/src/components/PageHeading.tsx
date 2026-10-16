import { Title, type TitleProps } from '@mantine/core'
import type { PropsWithChildren } from 'react'

const focusHeading = (node: HTMLHeadingElement | null) => { node?.focus({ preventScroll: true }) }

export default function PageHeading({ children, ...props }: PropsWithChildren<Pick<TitleProps, 'size' | 'id'>>) {
  return <Title order={1} tabIndex={-1} ref={focusHeading} {...props}>{children}</Title>
}
