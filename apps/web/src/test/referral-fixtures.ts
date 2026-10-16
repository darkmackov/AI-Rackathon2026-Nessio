import type { Case, Handover, Message } from '../client/types.gen'
import { demoState } from './setup'

export function seedReferral(id = 'test-referral', overrides: Partial<Case> = {}, handover: Partial<Handover> = {}) {
  const item: Case = { id, patient_name: '', koc_id: 'koc2-lipova', referring_doctor_id: 'pl-reznicek', state: 'koncept', queue: 'novy', created_at: '2026-10-02T14:00:00', ...overrides }
  demoState.saveCase(item)
  demoState.documents.saveHandover({ case_id: id, as_of: '2026-10-21', ...handover })
  return item
}

export function seedReturnedReferral() {
  const item = seedReferral('test-returned', { state: 'vraceno_lekari', queue: 'aktivni', coordinator_id: 'koordinator', patient_name: 'Fiktivní pacient', on_move: 'pl-reznicek' },
    { validated_by_referrer: { by: 'pl-reznicek', at: '2026-10-19T09:00:00' } })
  const message: Message = { id: 'test-return-note', case_id: item.id, kind: 'case_returned', sender_id: 'koordinator', recipient_ids: ['pl-reznicek'], subject: 'Doplnění žádosti',
    body: 'Fiktivní poznámka koordinátora: doplňte dostupný kontakt na pacienta.', sent_at: '2026-10-20T10:00:00', simulated: true }
  demoState.saveMessage(message)
  return item
}
