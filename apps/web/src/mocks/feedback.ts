import { http, HttpResponse } from 'msw'
import type { Actor, Case, Message, Receipt } from '../client/types.gen'
import { actors } from './directory'
import type { createDemoState } from './handlers'
import { fail, readBody } from './coordinator-validation'
import { validationResponse } from './validation'
import { transition } from './audit-text'

// User-authorized S6 simulation at the HTTP boundary (Q-W16): the only owner of feedback, inbox and receipt rules.
const noticeStates = ['v_triage', 'ceka_na_podklady', 'kompletni', 'pripraveno_k_mdt', 'zaver_mdt', 'zpetna_vazba_odeslana']
const newestFirst = (a: Message, b: Message) => (b.sent_at ?? '').localeCompare(a.sent_at ?? '') || b.id.localeCompare(a.id, undefined, { numeric: true })

export function createFeedbackHandlers(state: ReturnType<typeof createDemoState>) {
    const store = state.coordinator, now = () => state.clock().now
    const caseById = (id: string): Case => store.cases().find((item) => item.id === id) ?? fail(404, 'case not found')
    function actor(request: Request): Actor {
        const id = request.headers.get('X-Actor-Id')
        if (id === null) throw validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }])
        const user = actors.find((item) => item.id === id) ?? fail(404, 'actor not found')
        if (user.role !== 'referring_doctor' && user.role !== 'coordinator') fail(403, 'wrong role')
        return user
    }
    function coordinator(user: Actor, item: Case) {
        if (user.role !== 'coordinator' || user.organization_id !== item.koc_id) fail(403, 'only a coordinator of the case\'s KOC')
    }
    // The case lists carry no actor header in the contract; a supplied one must still belong to the case.
    function reader(request: Request, item: Case) {
        if (request.headers.get('X-Actor-Id') === null) return
        const user = actor(request)
        if (!(user.role === 'coordinator' && user.organization_id === item.koc_id) && user.id !== item.referring_doctor_id) fail(403, 'not a participant of this case')
    }
    const route = (method: 'get' | 'post', path: string, action: (request: Request, params: Record<string, string | readonly string[] | undefined>) => Response | Promise<Response>) =>
        http[method](`*/api${path}`, async ({ request, params }) => {
            try { return await action(request, params) } catch (error) { if (error instanceof Response) return error; throw error }
        })
    const caseMessages = (caseId: string) => store.messages(caseId).sort(newestFirst)
    return [
        route('post', '/cases/:caseId/feedback', async (request, params) => {
            const user = actor(request)
            const body = await readBody(request, ['note']), note = body.text('note') || null; body.done()
            const item = caseById(String(params.caseId)); coordinator(user, item)
            if (item.state === 'zpetna_vazba_odeslana' || item.state === 'uzavreno') fail(409, 'the feedback has already been sent')
            if (item.state !== 'zaver_mdt') fail(409, `the feedback is sent from zaver_mdt, not ${item.state}`)
            const conclusion = state.mdt.conclusion(item.id)
            if (!conclusion?.confirmed) fail(409, 'the MDT conclusion is not confirmed')
            if (!state.mdt.record(item.id)) fail(409, 'the MDT input is not available')
            // The conclusion and the frozen MDT input travel through the MDT endpoints; only real case documents are attached.
            if (conclusion.document_id && state.documents.get(conclusion.document_id)?.case_id !== item.id) fail(409, 'the conclusion document is not available')
            const uploaded = conclusion.document_id ? [conclusion.document_id] : []
            const message: Message = {
                id: store.id('message'), case_id: item.id, kind: 'mdt_result', channel: 'in_app', sender_id: user.id, recipient_ids: [item.referring_doctor_id],
                subject: `Výsledek MDT: ${item.patient_name}`, body: note ?? '', attachment_document_ids: uploaded, finding_id: null, sent_at: now(), simulated: false
            }
            store.saveMessage(message)
            store.saveCase({ ...item, state: 'zpetna_vazba_odeslana' }); store.sync(item.id)
            store.record(item.id, user.id, now(), 'feedback_sent', `${transition('zaver_mdt', 'zpetna_vazba_odeslana')}${note ? `\nPoznámka: ${note}` : ''}`)
            return HttpResponse.json(message, { status: 201 })
        }),
        route('post', '/cases/:caseId/patient-notices', async (request, params) => {
            const user = actor(request)
            const body = await readBody(request, ['subject', 'body']), subject = body.text('subject', true), text = body.text('body', true); body.done()
            const item = caseById(String(params.caseId)); coordinator(user, item)
            if (!noticeStates.includes(item.state ?? '')) fail(409, `a patient notice can't be recorded in state ${item.state}`)
            // Recorded, never delivered (Q-F16): the patient has no inbox in the app.
            const message: Message = {
                id: store.id('message'), case_id: item.id, kind: 'patient_notice', channel: 'in_app', sender_id: user.id, recipient_ids: [],
                subject: subject ?? '', body: text ?? '', attachment_document_ids: [], finding_id: null, sent_at: now(), simulated: true
            }
            store.saveMessage(message)
            store.record(item.id, user.id, now(), 'patient_notice_created', `${message.subject}\nSimulace, pacientovi nedoručeno.`)
            return HttpResponse.json(message, { status: 201 })
        }),
        route('get', '/cases/:caseId/messages', (request, params) => {
            const item = caseById(String(params.caseId)); reader(request, item)
            return HttpResponse.json(caseMessages(item.id))
        }),
        route('get', '/cases/:caseId/receipts', (request, params) => {
            const item = caseById(String(params.caseId)); reader(request, item)
            return HttpResponse.json(store.receipts(caseMessages(item.id).map((message) => message.id)).sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at)))
        }),
        route('get', '/inbox', (request) => {
            const user = actor(request)
            return HttpResponse.json(store.messages().filter((message) => message.recipient_ids.includes(user.id)).sort(newestFirst))
        }),
        route('post', '/messages/:messageId/confirm', (request, params) => {
            const user = actor(request)
            const message = store.messages().find((entry) => entry.id === String(params.messageId)) ?? fail(404, 'message not found')
            if (!message.recipient_ids.includes(user.id)) fail(403, 'only a recipient can confirm receipt')
            // Confirming again returns the same receipt and records nothing.
            const existing = store.receipts([message.id]).find((entry) => entry.recipient_id === user.id)
            if (existing) return HttpResponse.json(existing, { status: 201 })
            const item = caseById(message.case_id)
            if (message.kind === 'mdt_result' && item.state !== 'zpetna_vazba_odeslana') fail(409, 'the case is not waiting for receipt')
            const receipt: Receipt = store.saveReceipt({ message_id: message.id, recipient_id: user.id, confirmed_at: now() })
            // Only the MDT result closes the case; a returned referral's note never does.
            const closes = message.kind === 'mdt_result' && item.state === 'zpetna_vazba_odeslana'
            if (closes) { store.saveCase({ ...item, state: 'uzavreno' }); store.sync(item.id) }
            store.record(item.id, user.id, now(), 'receipt_confirmed', `${message.subject}${closes ? `\n${transition('zpetna_vazba_odeslana', 'uzavreno')}` : ''}`)
            return HttpResponse.json(receipt, { status: 201 })
        }),
    ]
}
