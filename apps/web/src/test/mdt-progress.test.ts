import { describe, expect, it } from 'vitest'
import type { MdtConclusion } from '../client/types.gen'
import { mdtStage, openSections, stageIndex } from '../screens/CaseDetail/Mdt/mdt-progress'

const saved: MdtConclusion = { case_id: 'case', confirmed: null }
const confirmed: MdtConclusion = { case_id: 'case', confirmed: { by: 'koordinator', at: '2026-10-21T15:00:00' } }

describe('MDT progress', () => {
  it('maps each case state and conclusion to the current MDT stage', () => {
    expect(mdtStage('v_triage', undefined)).toBe('preparation')
    // Waiting for documents never blocks the MDT input.
    expect(mdtStage('ceka_na_podklady', undefined)).toBe('snapshot')
    expect(mdtStage('kompletni', undefined)).toBe('snapshot')
    expect(mdtStage('pripraveno_k_mdt', null)).toBe('conclusion')
    expect(mdtStage('pripraveno_k_mdt', saved)).toBe('confirm')
    // A correction in Závěr MDT drops the confirmation and needs a new one (Q-F34).
    expect(mdtStage('zaver_mdt', saved)).toBe('confirm')
    expect(mdtStage('zaver_mdt', confirmed)).toBe('send')
    expect(mdtStage('zpetna_vazba_odeslana', confirmed)).toBe('done')
    expect(mdtStage('uzavreno', confirmed)).toBe('done')
  })

  it('marks every step complete once the conclusion is sent', () => {
    expect(stageIndex('preparation')).toBe(0)
    expect(stageIndex('send')).toBe(4)
    expect(stageIndex('done')).toBe(5)
  })

  it('opens only the sections of the current stage', () => {
    expect(openSections('snapshot')).toEqual(['preparation', 'record'])
    expect(openSections('conclusion')).toEqual(['record', 'conclusion'])
    expect(openSections('confirm')).toEqual(['conclusion'])
    expect(openSections('done')).toEqual(['conclusion'])
  })
})
