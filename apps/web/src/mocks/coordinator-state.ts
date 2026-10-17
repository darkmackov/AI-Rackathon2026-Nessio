import type { AuditEvent, Case, CaseState, Message, Receipt, Task, TaskSet } from '../client/types.gen'
import { referenceCases } from './reference'
import { referenceTasks } from './reference-tasks'

export const s4CaseId = 'demo-s4'
export const s4Case: Case = {
  id: s4CaseId, patient_name: 'Fiktivní pacient S4', diagnosis_label: 'Fiktivní ukázka koordinace',
  koc_id: 'koc2-lipova', referring_doctor_id: 'pl-reznicek', state: 'odeslano', queue: 'novy', priority: 'normal',
  created_at: '2026-10-21T08:00:00', on_move: 'koordinator', next_step: 'Převzít případ', milestones: { referred_at: '2026-10-21T08:00:00' },
}

const seedSet: TaskSet = {
  id: 'ca-pankreas', name: 'Karcinom pankreatu – diagnostika do MDT', diagnosis_codes: ['C25'],
  steps: [
    { key: 'ct', title: 'CT břicha a hrudníku', kind: 'imaging', owner_role: 'coordinator', due_offset_days: 6 },
    { key: 'eus', title: 'EUS-FNB', kind: 'biopsy', owner_role: 'coordinator', due_offset_days: 10, depends_on: ['ct'] },
    { key: 'histo', title: 'Výsledek histologie', kind: 'histology', owner_role: 'coordinator', due_offset_days: 17, depends_on: ['eus'] },
    { key: 'lab', title: 'Kontrolní odběry', kind: 'lab', owner_role: 'coordinator', due_offset_days: 13 },
    { key: 'mdt', title: 'MDT pro nádory GIT', kind: 'mdt', owner_role: 'coordinator', due_offset_days: 19, depends_on: ['ct', 'lab', 'histo'] },
    { key: 'pain', title: 'Algeziologie', kind: 'consult', owner_role: 'coordinator', due_offset_days: 24 },
    { key: 'psych', title: 'Klinický psycholog', kind: 'consult', owner_role: 'coordinator', due_offset_days: 25 },
  ],
}

// Only the HTTP demo boundary owns workflow rules and mutable server state.
export const transitions: Partial<Record<CaseState, CaseState[]>> = {
  odeslano: ['v_triage'], v_triage: ['ceka_na_podklady', 'kompletni', 'vraceno_lekari'],
  ceka_na_podklady: ['kompletni', 'vraceno_lekari'], kompletni: ['ceka_na_podklady', 'vraceno_lekari'],
}

export function createCoordinatorState() {
  const cases = new Map<string, Case>()
  const tasks = new Map<string, Task>()
  const sets = new Map<string, TaskSet>()
  const audit: AuditEvent[] = []
  const messages: Message[] = []
  const receipts: Receipt[] = []
  const runs = new Set<string>()
  let sequence = 0
  const clone = structuredClone
  function reset(reference: boolean) {
    cases.clear(); tasks.clear(); sets.clear(); audit.length = 0; messages.length = 0; receipts.length = 0; runs.clear(); sequence = 0
    sets.set(seedSet.id, clone(seedSet))
    if (!reference) return
    for (const item of [...referenceCases, s4Case]) cases.set(item.id, clone(item))
    for (const task of referenceTasks) tasks.set(task.id, clone(task))
    runs.add('vzp-prochazkova:ca-pankreas')
  }
  function saveCase(item: Case) { cases.set(item.id, clone(item)); return clone(item) }
  function sync(id: string) {
    const item = cases.get(id)
    if (!item) return
    const all = [...tasks.values()].filter((task) => task.case_id === id)
    const done = new Set(all.filter((task) => task.status === 'done').map((task) => task.id))
    const next = all.filter((task) => task.status !== 'done' && task.status !== 'cancelled' && (task.depends_on ?? []).every((key) => done.has(key)))
      .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.id.localeCompare(b.id))[0]
    const queue = item.on_hold ? 'odlozeny' : ['odeslano', 'v_triage', 'koncept'].includes(item.state ?? '') ? 'novy' : 'aktivni'
    const returned = item.state === 'vraceno_lekari'
    // After the feedback the GP is on the move until the receipt, a closed case nobody; neither has a step and tasks never override them (S6).
    if (item.state === 'zpetna_vazba_odeslana' || item.state === 'uzavreno') {
      saveCase({ ...item, queue, on_move: item.state === 'zpetna_vazba_odeslana' ? item.referring_doctor_id : null, next_step: null, next_due: null })
      return
    }
    saveCase({
      ...item, queue, on_move: returned ? item.referring_doctor_id : next?.owner ?? item.coordinator_id ?? null,
      next_step: returned ? 'Doplnit a znovu odeslat předávku' : next?.title ?? null, next_due: returned ? null : next?.due ?? null
    })
  }
  return {
    reset, sync, saveCase,
    id: (prefix: string) => `demo-${prefix}-${++sequence}`,
    cases: () => clone([...cases.values()]),
    tasks: (caseId: string) => clone([...tasks.values()].filter((item) => item.case_id === caseId)),
    task: (id: string) => { const item = tasks.get(id); return item && clone(item) },
    saveTask: (item: Task) => { tasks.set(item.id, clone(item)); sync(item.case_id); return clone(item) },
    sets: () => clone([...sets.values()]),
    saveSet: (item: TaskSet) => { sets.set(item.id, clone(item)); return clone(item) },
    hasRun: (caseId: string, setId: string) => runs.has(`${caseId}:${setId}`),
    markRun: (caseId: string, setId: string) => runs.add(`${caseId}:${setId}`),
    audit: (caseId: string) => clone(audit.filter((item) => item.case_id === caseId).sort((a, b) => a.at.localeCompare(b.at))),
    record: (caseId: string, actorId: string, at: string, action: string, detail?: string) => {
      audit.push({ id: `demo-audit-${++sequence}`, case_id: caseId, actor_id: actorId, at, action, detail })
    },
    saveMessage: (message: Message) => { messages.splice(0, messages.length, ...messages.filter((item) => item.id !== message.id), clone(message)) },
    messages: (caseId?: string) => clone(messages.filter((item) => !caseId || item.case_id === caseId)),
    receipts: (messageIds: string[]) => clone(receipts.filter((item) => messageIds.includes(item.message_id))),
    saveReceipt: (receipt: Receipt) => { receipts.push(clone(receipt)); return clone(receipt) },
  }
}
