import type { Case } from '../client/types.gen'

// Snapshot of apps/api/src/onko_api/seed.py: the MDT morning, complete, before the MDT snapshot
// (Q-F40). No clinical rules are run in the web app.
export const referenceCases: Case[] = [{
  id: 'vzp-prochazkova',
  patient_name: 'Alena Procházková',
  diagnosis_label: 'C25.0 Duktální adenokarcinom hlavy pankreatu',
  koc_id: 'koc2-lipova',
  mdt_board_id: 'mdt-git-lipova',
  referring_doctor_id: 'pl-reznicek',
  coordinator_id: 'koordinator',
  state: 'kompletni',
  priority: 'high',
  queue: 'aktivni',
  on_move: 'koordinator',
  next_step: 'MDT pro nádory GIT',
  next_due: '2026-10-21T14:00:00',
  mdt_date: '2026-10-21',
  created_at: '2026-10-02T14:00:00',
  on_hold: null,
  milestones: {
    symptom_onset: '2026-08-15', referred_at: '2026-10-02T14:00:00',
    mdt_held: null, treatment_start: null,
  },
}]
