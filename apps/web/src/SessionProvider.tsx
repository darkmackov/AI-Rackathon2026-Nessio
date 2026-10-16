import type { PropsWithChildren } from 'react'
import { SessionContext, useSessionState } from './session'

export default function SessionProvider({ children }: PropsWithChildren) {
  const session = useSessionState()
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}
