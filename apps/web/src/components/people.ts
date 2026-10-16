import { useQuery } from '@tanstack/react-query'
import { listActorsOptions, listOrganizationsOptions } from '../client/@tanstack/react-query.gen'
import type { Actor, Organization } from '../client/types.gen'

export type Person = { actor: Actor; organization?: Organization } | { actor?: undefined; organization: Organization }

// Resolves directory ids (actors and organisations share the `on_move`, stamp and owner fields) to their records.
export function usePeople(enabled = true) {
  const actors = useQuery({ ...listActorsOptions(), enabled })
  const organizations = useQuery({ ...listOrganizationsOptions(), enabled })
  const organization = (id?: string | null) => (id ? organizations.data?.find((item) => item.id === id) : undefined)
  const person = (id?: string | null): Person | undefined => {
    if (!id) return undefined
    const actor = actors.data?.find((item) => item.id === id)
    if (actor) return { actor, organization: organization(actor.organization_id) }
    const found = organization(id)
    return found && { organization: found }
  }
  const names: Record<string, string> = Object.fromEntries([...(actors.data ?? []), ...(organizations.data ?? [])].map((entry) => [entry.id, entry.name]))
  return { actors, organizations, person, organization, names }
}
