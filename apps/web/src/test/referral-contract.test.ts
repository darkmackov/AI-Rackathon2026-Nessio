import { describe, expect, it } from 'vitest'
import { actorHeaders, createQueryClient } from '../api'
import { addExaminationMutation, createReferralMutation, getHandoverOptions, listAuditOptions, listCasesOptions, listInboxOptions, returnCaseMutation, sendReferralMutation, takeOverCaseMutation, updateHandoverFieldMutation, validateHandoverMutation } from '../client/@tanstack/react-query.gen'
import type { HandoverFieldUpdate } from '../client/types.gen'
import { expectApiResponse } from './api-contract'
import { s4CaseId } from '../mocks/coordinator-state'
import { seedReferral, seedReturnedReferral } from './referral-fixtures'
import { demoState } from './setup'

describe('S3 HTTP demo contracts', () => {
  it('creates a draft, records manual values and examinations, validates and sends to the new queue', async () => {
    const query = createQueryClient()
    const headers = actorHeaders('pl-reznicek')
    const create = query.getMutationCache().build(query, createReferralMutation())
    const item = await create.execute({ headers, body: { koc_id: 'koc1-severni' } })
    expectApiResponse('create_referral', 201, item)
    const options = { headers, path: { case_id: item.id } }
    expect(item).toMatchObject({ state: 'koncept', koc_id: 'koc1-severni', referring_doctor_id: 'pl-reznicek', patient_name: '' })
    expect((await query.fetchQuery(listCasesOptions({ query: { koc_id: item.koc_id } }))).some((entry) => entry.id === item.id)).toBe(false)
    expect((await query.fetchQuery(listCasesOptions({ headers, query: { referring_doctor_id: 'pl-reznicek' } }))).some((entry) => entry.id === item.id)).toBe(true)
    expectApiResponse('get_handover', 200, await query.fetchQuery(getHandoverOptions(options)))
    const patch = query.getMutationCache().build(query, updateHandoverFieldMutation())
    const bodies: HandoverFieldUpdate[] = [
      { path: 'patient.first_name', value: 'Fiktivní' }, { path: 'patient.last_name', value: 'Pacient' },
      { path: 'patient.birth_date', value: '1980-01-02' }, { path: 'patient.age', value: 46 },
      { path: 'contacts.patient_email', not_available: true, note: 'Lékař nemá k dispozici.' },
      { path: 'comorbidities', value: ['Fiktivní údaj A', 'Fiktivní údaj B'] }, { path: 'weight_kg', value: 65.5 },
    ]
    for (const body of bodies) expectApiResponse('update_handover_field', 200, await patch.execute({ ...options, body }))
    expect(demoState.documents.result(item.id)?.handover.contacts?.patient_email).toMatchObject({ status: 'missing', origin: 'manual', value: null, entered: { by: 'pl-reznicek' } })
    const exam = query.getMutationCache().build(query, addExaminationMutation())
    const examination = await exam.execute({ ...options, body: { date: '2026-10-01', place: 'Fiktivní ordinace', type: 'Kontrola', result_full_text: 'Fiktivní výsledek bez klinických údajů.' } })
    expectApiResponse('add_examination', 201, examination)
    expect(examination.examinations?.[0]).toMatchObject({ origin: 'manual', entered: { by: 'pl-reznicek' } })
    const validate = query.getMutationCache().build(query, validateHandoverMutation())
    const validated = await validate.execute(options)
    expectApiResponse('validate_handover', 200, validated)
    expect(validated.validated_by_referrer?.by).toBe('pl-reznicek')
    const send = query.getMutationCache().build(query, sendReferralMutation())
    const sent = await send.execute(options)
    expectApiResponse('send_referral', 200, sent)
    expect(sent).toMatchObject({ state: 'odeslano', queue: 'novy', patient_name: 'Fiktivní Pacient' })
    expect((await query.fetchQuery(listCasesOptions({ query: { koc_id: item.koc_id } }))).map((entry) => entry.id)).toContain(item.id)
    await expect(patch.execute({ ...options, body: { path: 'diagnosis', value: 'změna po odeslání' } })).rejects.toMatchObject({ status: 409 })
  })

  it('requires a new validation after a return and preserves the assigned coordinator on resending', async () => {
    const item = seedReturnedReferral()
    const query = createQueryClient()
    const options = { headers: actorHeaders(item.referring_doctor_id), path: { case_id: item.id } }
    const inbox = await query.fetchQuery(listInboxOptions({ headers: options.headers }))
    expectApiResponse('list_inbox', 200, inbox)
    expect(inbox[0].body).toContain('Fiktivní poznámka koordinátora')
    expect(await query.fetchQuery(listInboxOptions({ headers: actorHeaders('pl-novakova') }))).toEqual([])
    const send = query.getMutationCache().build(query, sendReferralMutation())
    await expect(send.execute(options)).rejects.toMatchObject({ status: 409 })
    const validate = query.getMutationCache().build(query, validateHandoverMutation())
    await validate.execute(options)
    expect(await send.execute(options)).toMatchObject({ state: 'v_triage', queue: 'novy', coordinator_id: 'koordinator', on_move: 'koordinator' })
  })

  it('rejects wrong doctors, wrong roles, unvalidated sends and invalid typed values', async () => {
    const item = seedReferral()
    const query = createQueryClient()
    const options = { headers: actorHeaders(item.referring_doctor_id), path: { case_id: item.id } }
    const create = query.getMutationCache().build(query, createReferralMutation())
    await expect(create.execute({ headers: actorHeaders('koordinator'), body: { koc_id: item.koc_id } })).rejects.toMatchObject({ status: 403 })
    const patch = query.getMutationCache().build(query, updateHandoverFieldMutation())
    await expect(patch.execute({ ...options, headers: actorHeaders('pl-novakova'), body: { path: 'diagnosis', value: 'neoprávněná změna' } })).rejects.toMatchObject({ status: 403 })
    await expect(patch.execute({ ...options, body: { path: 'weight_kg', value: 'not a number' } })).rejects.toMatchObject({ status: 422 })
    const send = query.getMutationCache().build(query, sendReferralMutation())
    await expect(send.execute(options)).rejects.toMatchObject({ status: 409 })
    expect(demoState.getCases().find((entry) => entry.id === item.id)?.state).toBe('koncept')
  })
  it('shares one handover editor rule, message store and audit with the coordinator workflow', async () => {
    const query = createQueryClient()
    const coordinator = { headers: actorHeaders('koordinator'), path: { case_id: s4CaseId } }
    const doctor = { headers: actorHeaders('pl-reznicek'), path: { case_id: s4CaseId } }
    const patch = query.getMutationCache().build(query, updateHandoverFieldMutation())
    await expect(patch.execute({ ...coordinator, body: { path: 'diagnosis', value: 'Před převzetím' } })).rejects.toMatchObject({ status: 409 })
    await query.getMutationCache().build(query, takeOverCaseMutation()).execute(coordinator)
    await expect(patch.execute({ ...doctor, body: { path: 'diagnosis', value: 'Po odeslání' } })).rejects.toMatchObject({ status: 409 })
    await expect(patch.execute({ ...coordinator, headers: actorHeaders('koord-severni'), body: { path: 'diagnosis', value: 'Cizí KOC' } })).rejects.toMatchObject({ status: 403 })
    expectApiResponse('update_handover_field', 200, await patch.execute({ ...coordinator, body: { path: 'diagnosis', value: 'Doplněno koordinátorem' } }))
    await query.getMutationCache().build(query, returnCaseMutation()).execute({ ...coordinator, body: { note: 'Fiktivní: doplňte kontakt.' } })
    const inbox = await query.fetchQuery(listInboxOptions({ headers: doctor.headers }))
    expect(inbox.find((message) => message.case_id === s4CaseId)).toMatchObject({ kind: 'case_returned', body: 'Fiktivní: doplňte kontakt.' })
    expectApiResponse('update_handover_field', 200, await patch.execute({ ...doctor, body: { path: 'contacts.patient_phone', value: '+420 777 000 000' } }))
    const audit = await query.fetchQuery(listAuditOptions(coordinator))
    expect(audit.filter((event) => event.action === 'handover_field').map((event) => event.actor_id)).toEqual(['koordinator', 'pl-reznicek'])
  })
})