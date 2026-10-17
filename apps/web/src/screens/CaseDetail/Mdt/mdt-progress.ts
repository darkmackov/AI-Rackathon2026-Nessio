import type { CaseState, MdtConclusion } from '../../../client/types.gen'

export const mdtStages = ['preparation', 'snapshot', 'conclusion', 'confirm', 'send'] as const
export type MdtStage = (typeof mdtStages)[number] | 'done'
export type MdtSection = 'preparation' | 'record' | 'conclusion'

/** Cases before the snapshot, whose handover the coordinator still prepares for the MDT. */
export const preparationStates: readonly CaseState[] = ['v_triage', 'ceka_na_podklady', 'kompletni']

/** Cases whose MDT input can be prepared: waiting for documents never blocks the MDT. */
export const snapshotStates: readonly CaseState[] = ['ceka_na_podklady', 'kompletni']

/**
 * Where the case is in the MDT workflow, for display only: the API decides what is allowed (WEB-6).
 * `conclusion` is null when none is saved and undefined while it is unknown.
 */
export function mdtStage(state: CaseState | null | undefined, conclusion: MdtConclusion | null | undefined): MdtStage {
  if (state && snapshotStates.includes(state)) return 'snapshot'
  if (state === 'pripraveno_k_mdt' || state === 'zaver_mdt') {
    if (!conclusion) return 'conclusion'
    return conclusion.confirmed ? 'send' : 'confirm'
  }
  if (state === 'zpetna_vazba_odeslana' || state === 'uzavreno') return 'done'
  return 'preparation'
}

/** The step the stepper marks as current; `done` marks every step complete. */
export const stageIndex = (stage: MdtStage) => stage === 'done' ? mdtStages.length : mdtStages.indexOf(stage)

/** Sections opened by default, so the current stage is in view and finished ones stay out of the way. */
export function openSections(stage: MdtStage): MdtSection[] {
  switch (stage) {
    case 'preparation': return ['preparation']
    case 'snapshot': return ['preparation', 'record']
    case 'conclusion': return ['record', 'conclusion']
    default: return ['conclusion']
  }
}
