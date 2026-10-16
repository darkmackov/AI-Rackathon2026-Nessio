import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useState } from 'react'
import { ApiError, actorHeaders } from './api'
import { meOptions } from './client/@tanstack/react-query.gen'

export type UserRole = 'referring_doctor' | 'coordinator'
export function isUserRole(role: string): role is UserRole {
  return role === 'referring_doctor' || role === 'coordinator'
}
export function roleHome(role: string) {
  return role === 'coordinator' ? '/coordinator' : '/referrer'
}

// The page to reopen after choosing a person again (a reload drops the identity, Q-W8). Only same-origin paths.
export function entrySearch(search: Record<string, unknown>): { redirect?: string } {
  const { redirect } = search
  return typeof redirect === 'string' && /^\/(?![/\\])/.test(redirect) ? { redirect } : {}
}

export function useSessionState() {
  const queryClient = useQueryClient()
  const [actorId, setActorId] = useState<string | null>(null)
  const identity = useQuery({
    ...meOptions({ headers: actorHeaders(actorId ?? '') }),
    enabled: actorId !== null,
    staleTime: Infinity,
  })

  async function leaveIdentity() {
    // Remove the old screen immediately, then abort and remove identity-scoped cache entries.
    setActorId(null)
    await queryClient.cancelQueries()
    queryClient.removeQueries({ predicate: (query) => {
      const key = query.queryKey[0]
      return !!key && typeof key === 'object' && 'headers' in key
    } })
  }

  async function selectActor(id: string) {
    const actor = await queryClient.fetchQuery({
      ...meOptions({ headers: actorHeaders(id) }), staleTime: 0,
    })
    if (!isUserRole(actor.role)) throw new ApiError(403, undefined)
    setActorId(actor.id)
    return actor
  }

  return { actorId, actor: identity.data, identity, selectActor, leaveIdentity }
}

export const SessionContext = createContext<ReturnType<typeof useSessionState> | null>(null)

export function useSession() {
  const session = useContext(SessionContext)
  if (!session) throw new Error('SessionProvider is required')
  return session
}
