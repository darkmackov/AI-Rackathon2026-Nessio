import { useIsMutating } from '@tanstack/react-query'
import type { ReactNode } from 'react'

/** Subscribe only the controls to the write lock, keeping their surrounding page unchanged. */
export default function WriteControls({ children }: { children: (busy: boolean) => ReactNode }) {
  return children(useIsMutating() > 0)
}
