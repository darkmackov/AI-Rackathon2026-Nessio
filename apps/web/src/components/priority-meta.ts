import type { Priority } from '../client/types.gen'

// One mapping for every screen: case and task priority share the same colours.
export const priorityColor: Record<Priority, string> = { normal: 'gray', high: 'orange', urgent: 'red' }
