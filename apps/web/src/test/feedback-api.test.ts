import { describe, expect, it } from 'vitest'
import { actorHeaders, createQueryClient } from '../api'
import * as api from '../client/@tanstack/react-query.gen'
import type { FeedbackSend, PatientNoticeCreate } from '../client/types.gen'
import { s4CaseId } from '../mocks/coordinator-state'
import { expectApiResponse } from './api-contract'
import { concludeReference, referenceId as caseId } from './feedback-fixtures'
import { mutation } from './mdt-fixtures'
import { demoState } from './setup'

const coordinator = actorHeaders('koordinator'), gp = actorHeaders('pl-reznicek')
const path = { case_id: caseId }
const current = (id = caseId) => demoState.getCases().find((item) => item.id === id)
const send = (body: FeedbackSend = {}, headers = coordinator, id = caseId) => mutation(api.sendFeedbackMutation(), { headers, path: { case_id: id }, body })
const confirm = (messageId: string, headers = gp) => mutation(api.confirmReceiptMutation(), { headers, path: { message_id: messageId } })
const notice = (body: PatientNoticeCreate, headers = coordinator, id = caseId) => mutation(api.createPatientNoticeMutation(), { headers, path: { case_id: id }, body })
const inbox = (headers = gp) => createQueryClient().fetchQuery(api.listInboxOptions({ headers }))

describe('S6 contract-shaped HTTP demo', () => {
  it('sends the confirmed result once, keeps the GP on the move and closes the case on the first receipt', async () => {
    await concludeReference()
    const message = await send({ note: 'Fiktivní poznámka pro lékaře.' })
    expectApiResponse('send_feedback', 201, message)
    expect(message).toMatchObject({ case_id: caseId, kind: 'mdt_result', sender_id: 'koordinator', recipient_ids: ['pl-reznicek'], body: 'Fiktivní poznámka pro lékaře.', attachment_document_ids: [], simulated: false })
    expect(current()).toMatchObject({ state: 'zpetna_vazba_odeslana', on_move: 'pl-reznicek', next_due: null })
    await expect(send()).rejects.toMatchObject({ status: 409 })
    // The sent result stays as sent: the conclusion is locked and a task change does not take the GP off the move.
    await expect(mutation(api.upsertMdtConclusionMutation(), { headers: coordinator, path, body: { conclusion: 'Pozdní změna.' } })).rejects.toMatchObject({ status: 409 })
    await mutation(api.updateTaskMutation(), { headers: coordinator, path: { task_id: 'vzp-prochazkova-ca-pankreas-mdt' }, body: { status: 'done' } })
    expect(current()).toMatchObject({ on_move: 'pl-reznicek', next_due: null })

    const received = await inbox()
    expectApiResponse('list_inbox', 200, received)
    expect(received[0]).toEqual(message)
    expectApiResponse('list_case_messages', 200, await createQueryClient().fetchQuery(api.listCaseMessagesOptions({ path })))
    expect(await createQueryClient().fetchQuery(api.listCaseReceiptsOptions({ path }))).toEqual([])

    await expect(confirm(message.id, coordinator)).rejects.toMatchObject({ status: 403 })
    await expect(confirm('unknown')).rejects.toMatchObject({ status: 404 })
    const receipt = await confirm(message.id)
    expectApiResponse('confirm_receipt', 201, receipt)
    expect(receipt).toMatchObject({ message_id: message.id, recipient_id: 'pl-reznicek' })
    expect(current()).toMatchObject({ state: 'uzavreno', on_move: null, next_step: null, next_due: null })
    expect(await confirm(message.id)).toEqual(receipt)
    const receipts = await createQueryClient().fetchQuery(api.listCaseReceiptsOptions({ path }))
    expectApiResponse('list_case_receipts', 200, receipts)
    expect(receipts).toEqual([receipt])

    await mutation(api.updateTaskMutation(), { headers: coordinator, path: { task_id: 'vzp-prochazkova-ca-pankreas-pain' }, body: { status: 'booked' } })
    expect(current()).toMatchObject({ state: 'uzavreno', on_move: null, next_step: null, next_due: null })
    const time = await createQueryClient().fetchQuery(api.getTimeToTreatmentOptions({ path }))
    expect(time.t2).toBe(19)
    const actions = (await createQueryClient().fetchQuery(api.listAuditOptions({ headers: coordinator, path }))).map((event) => event.action)
    expect(actions.filter((action) => action === 'feedback_sent')).toHaveLength(1)
    expect(actions.filter((action) => action === 'receipt_confirmed')).toHaveLength(1)
  })

  it('refuses feedback without a confirmed conclusion, from the wrong people, for unknown cases and with invalid bodies', async () => {
    await expect(send()).rejects.toMatchObject({ status: 409 })  // still Kompletní
    await concludeReference(false)
    demoState.saveCase({ ...current()!, state: 'zaver_mdt' })
    await expect(send()).rejects.toMatchObject({ status: 409 })  // conclusion saved but not confirmed
    await mutation(api.confirmMdtConclusionMutation(), { headers: coordinator, path })
    for (const actor of ['pl-reznicek', 'koord-severni']) await expect(send({}, actorHeaders(actor))).rejects.toMatchObject({ status: 403 })
    await expect(send({}, coordinator, 'unknown')).rejects.toMatchObject({ status: 404 })
    await expect(mutation(api.sendFeedbackMutation(), { headers: coordinator, path, body: { note: 5 } as never })).rejects.toMatchObject({ status: 422 })
    await expect(mutation(api.sendFeedbackMutation(), { headers: coordinator, path, body: { extra: true } as never })).rejects.toMatchObject({ status: 422 })
    await expect(inbox({ 'X-Actor-Id': 'nobody' })).rejects.toMatchObject({ status: 404 })
    expect(current()?.state).toBe('zaver_mdt')
    expect(await inbox()).toEqual([])
  })

  it('records a simulated patient notice without changing the case or anyone\'s inbox', async () => {
    const before = current()
    const message = await notice({ subject: 'Termín vyšetření', body: 'Fiktivní text oznámení.' })
    expectApiResponse('create_patient_notice', 201, message)
    expect(message).toMatchObject({ kind: 'patient_notice', simulated: true, recipient_ids: [], subject: 'Termín vyšetření' })
    expect(current()).toEqual(before)
    expect(await inbox()).toEqual([])
    await expect(notice({ subject: '', body: 'x' })).rejects.toMatchObject({ status: 422 })
    await expect(notice({ subject: 'x', body: 'y' }, gp)).rejects.toMatchObject({ status: 403 })
    await expect(notice({ subject: 'x', body: 'y' }, coordinator, s4CaseId)).rejects.toMatchObject({ status: 409 })  // Odesláno, not yet taken over
    demoState.saveCase({ ...current()!, state: 'uzavreno' })
    await expect(notice({ subject: 'x', body: 'y' })).rejects.toMatchObject({ status: 409 })
    const actions = (await createQueryClient().fetchQuery(api.listAuditOptions({ headers: coordinator, path }))).map((event) => event.action)
    expect(actions).toEqual(['patient_notice_created'])
  })

  it('lists a returned referral in the inbox; confirming it never closes the case', async () => {
    demoState.saveCase({ ...current(s4CaseId)!, state: 'v_triage', coordinator_id: 'koordinator' })
    await mutation(api.returnCaseMutation(), { headers: coordinator, path: { case_id: s4CaseId }, body: { note: 'Doplňte prosím fiktivní údaj.' } })
    const [returned] = await inbox()
    expect(returned).toMatchObject({ kind: 'case_returned', case_id: s4CaseId })
    await confirm(returned.id)
    expect(current(s4CaseId)?.state).toBe('vraceno_lekari')
    expect(await createQueryClient().fetchQuery(api.listCaseMessagesOptions({ path: { case_id: s4CaseId } }))).toHaveLength(1)
    await expect(createQueryClient().fetchQuery(api.listCaseMessagesOptions({ path: { case_id: 'unknown' } }))).rejects.toMatchObject({ status: 404 })
    await expect(createQueryClient().fetchQuery(api.listCaseReceiptsOptions({ headers: actorHeaders('koord-severni'), path: { case_id: s4CaseId } }))).rejects.toMatchObject({ status: 403 })
  })

  it('keeps the frozen MDT input and the sent result when reports arrive after the MDT, and clears everything on reset', async () => {
    await concludeReference()
    const frozen = demoState.mdt.snapshot(caseId), record = demoState.mdt.record(caseId)
    const message = await send()
    demoState.documents.upload(caseId, new File(['%PDF'], 'pozdni-zprava.pdf', { type: 'application/pdf' }), 'koordinator', '2026-10-25T08:00:00', '2026-10-25T08:00:00')
    expect(demoState.mdt.snapshot(caseId)).toEqual(frozen)
    expect(demoState.mdt.record(caseId)).toEqual(record)
    expect((await inbox())[0]).toEqual(message)
    demoState.reset('reference_at_mdt')
    expect(await inbox()).toEqual([])
    expect(await createQueryClient().fetchQuery(api.listCaseReceiptsOptions({ path }))).toEqual([])
  })

  it('attaches an existing source document and refuses a missing attachment without sending', async () => {
    await concludeReference()
    const conclusion = demoState.mdt.conclusion(caseId)
    const document = demoState.documents.list(caseId)[0]
    if (!conclusion || !document) throw new Error('Missing reference fixtures')
    demoState.mdt.saveConclusion({ ...conclusion, document_id: 'missing-document' })
    await expect(send()).rejects.toMatchObject({ status: 409 })
    expect(await inbox()).toEqual([])
    expect(current()?.state).toBe('zaver_mdt')
    demoState.mdt.saveConclusion({ ...conclusion, document_id: document.id })
    const message = await send()
    expect(message.attachment_document_ids).toEqual([document.id])
    expect(await inbox(actorHeaders('pl-novakova'))).toEqual([])
    await expect(confirm(message.id, actorHeaders('pl-novakova'))).rejects.toMatchObject({ status: 403 })
    expect(await createQueryClient().fetchQuery(api.listCaseReceiptsOptions({ path }))).toEqual([])
  })

  it('does not create a receipt or audit event for a result in a case that is not waiting for receipt', async () => {
    await concludeReference()
    const message = await send()
    const item = current()
    if (!item) throw new Error('Missing reference case')
    demoState.saveCase({ ...item, state: 'zaver_mdt' })
    await expect(confirm(message.id)).rejects.toMatchObject({ status: 409 })
    expect(await createQueryClient().fetchQuery(api.listCaseReceiptsOptions({ path }))).toEqual([])
    expect(demoState.coordinator.audit(caseId).some((event) => event.action === 'receipt_confirmed')).toBe(false)
  })
})
