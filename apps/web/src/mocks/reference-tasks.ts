import type { Task } from '../client/types.gen'

// Snapshot of the existing reference seed, not a task-set implementation.
const prefix = 'vzp-prochazkova-ca-pankreas-'
export const referenceTasks: Task[] = [
  { id: `${prefix}ct`, case_id: 'vzp-prochazkova', title: 'CT břicha a hrudníku, pankreatický protokol (KOC 1)', kind: 'imaging', owner: 'koc1-severni', due: '2026-10-08T14:00:00', status: 'done', external: true, depends_on: [] },
  { id: `${prefix}eus`, case_id: 'vzp-prochazkova', title: 'EUS-FNB ložiska hlavy pankreatu', kind: 'biopsy', owner: 'koordinator', due: '2026-10-12T14:00:00', status: 'done', depends_on: [`${prefix}ct`] },
  { id: `${prefix}lab`, case_id: 'vzp-prochazkova', title: 'Kontrolní odběry: KO, biochemie, nádorové markery', kind: 'lab', owner: 'koordinator', due: '2026-10-15T14:00:00', status: 'done', depends_on: [] },
  { id: `${prefix}histo`, case_id: 'vzp-prochazkova', title: 'Výsledek histologie', kind: 'histology', owner: 'pato-pokorny', due: '2026-10-19T14:00:00', status: 'done', depends_on: [`${prefix}eus`] },
  { id: `${prefix}mdt`, case_id: 'vzp-prochazkova', title: 'MDT pro nádory GIT', kind: 'mdt', owner: 'koordinator', due: '2026-10-21T14:00:00', status: 'planned', depends_on: [`${prefix}ct`, `${prefix}lab`, `${prefix}histo`] },
  { id: `${prefix}pain`, case_id: 'vzp-prochazkova', title: 'Algeziologie (KOC 1)', kind: 'consult', owner: 'koc1-severni', due: '2026-10-26T14:00:00', status: 'planned', external: true, depends_on: [] },
  { id: `${prefix}psych`, case_id: 'vzp-prochazkova', title: 'Klinický psycholog', kind: 'consult', owner: 'psycholog-vesela', due: '2026-10-27T14:00:00', status: 'planned', depends_on: [] },
]
