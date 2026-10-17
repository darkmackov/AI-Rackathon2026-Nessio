import { http, HttpResponse } from 'msw'
import type { Actor, Case, Message, Receipt } from '../client/types.gen'
import { actors } from './directory'
import type { createDemoState } from './handlers'
import { fail, readBody } from './coordinator-validation'
import { quotedDocuments } from './mdt-state'
import { validationResponse } from './validation'
import { transition } from './audit-text'

// S6 simulation at the HTTP boundary (Q-W16). It mirrors the backend's rules (onko_cases.feedback,
// onko_messaging) and its audit action names, so mock and real mode behave the same.
const noticeLocked = ['koncept', 'odeslano', 'uzavreno']
const czechDate = (day: string) => { const [year, month, date] = day.split('-').map(Number); return `${date}. ${month}. ${year}` }
const oldestFirst = (a: Message, b: Message) => (a.sent_at ?? '').localeCompare(b.sent_at ?? '') || a.id.localeCompare(b.id, undefined, { numeric: true })
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
    const route = (method: 'get' | 'post', path: string, action: (request: Request, params: Record<string, string | readonly string[] | undefined>) => Response | Promise<Response>) =>
        http[method](`*/api${path}`, async ({ request, params }) => {
            try { return await action(request, params) } catch (error) { if (error instanceof Response) return error; throw error }
        })
    const caseMessages = (caseId: string) => store.messages(caseId).sort(oldestFirst)
    return [
        route('post', '/cases/:caseId/feedback', async (request, params) => {
            const user = actor(request)
            const body = await readBody(request, ['note']), note = body.text('note') || null; body.done()
            const item = caseById(String(params.caseId)); coordinator(user, item)
            const conclusion = state.mdt.conclusion(item.id) ?? fail(404, 'no MDT conclusion yet')
            if (item.state !== 'zaver_mdt') fail(409, `the feedback is sent from zaver_mdt, not ${item.state}`)
            if (!conclusion.confirmed) fail(409, 'confirm the MDT conclusion before sending it')
            // The uploaded report first, then every document the frozen MDT snapshot quotes (the original context).
            const snapshot = state.mdt.snapshot(item.id)
            const attachments = [...new Set([...(conclusion.document_id ? [conclusion.document_id] : []), ...(snapshot ? quotedDocuments(snapshot) : [])])]
            const held = conclusion.date ?? item.mdt_date
            const text = conclusion.conclusion?.trim() || 'Závěr MDT v příloze'
            const message: Message = {
                id: store.id('message'), case_id: item.id, kind: 'mdt_result', channel: 'in_app', sender_id: user.id, recipient_ids: [item.referring_doctor_id],
                subject: held ? `Závěr MDT ze dne ${czechDate(held)}` : 'Závěr MDT', body: [note?.trim(), text].filter(Boolean).join('\n\n'),
                attachment_document_ids: attachments, finding_id: null, sent_at: now(), simulated: false
            }
            store.saveMessage(message)
            store.saveCase({ ...item, state: 'zpetna_vazba_odeslana' }); store.sync(item.id)
            store.record(item.id, user.id, now(), 'feedback_sent', `${transition('zaver_mdt', 'zpetna_vazba_odeslana')}, příloh: ${attachments.length}`)
            return HttpResponse.json(message, { status: 201 })
        }),
        route('post', '/cases/:caseId/patient-notices', async (request, params) => {
            const user = actor(request)
            const body = await readBody(request, ['subject', 'body']), subject = body.text('subject', true), text = body.text('body', true); body.done()
            const item = caseById(String(params.caseId)); coordinator(user, item)
            if (noticeLocked.includes(item.state ?? '')) fail(409, `the patient can't be notified in state ${item.state}`)
            // Recorded, never delivered (Q-F16): the patient has no inbox in the app.
            const message: Message = {
                id: store.id('message'), case_id: item.id, kind: 'patient_notice', channel: 'in_app', sender_id: user.id, recipient_ids: [],
                subject: subject ?? '', body: text ?? '', attachment_document_ids: [], finding_id: null, sent_at: now(), simulated: true
            }
            store.saveMessage(message)
            store.record(item.id, user.id, now(), 'patient_notice_sent', `${message.subject} (simulováno)`)
            return HttpResponse.json(message, { status: 201 })
        }),
        route('get', '/cases/:caseId/messages', (_request, params) => {
            const item = caseById(String(params.caseId))
            return HttpResponse.json(caseMessages(item.id))
        }),
        route('get', '/cases/:caseId/receipts', (_request, params) => {
            const item = caseById(String(params.caseId))
            return HttpResponse.json(store.receipts(caseMessages(item.id).map((message) => message.id)).sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at)))
        }),
        route('get', '/inbox', (request) => {
            const user = actor(request)
            return HttpResponse.json(store.messages().filter((message) => message.recipient_ids.includes(user.id)).sort(newestFirst))
        }),
        route('post', '/messages/:messageId/confirm', (request, params) => {
            const user = actor(request)
            const message = store.messages().find((entry) => entry.id === String(params.messageId)) ?? fail(404, 'message not found')
            const item = caseById(message.case_id)
            if (!message.recipient_ids.includes(user.id)) fail(403, 'Only a recipient can confirm receipt')
            if (message.kind !== 'mdt_result') fail(409, `receipt is confirmed for mdt_result, not ${message.kind}`)
            if (store.receipts([message.id]).some((entry) => entry.recipient_id === user.id)) fail(409, 'receipt already confirmed')
            if (item.state !== 'zpetna_vazba_odeslana') fail(409, `a case closes from zpetna_vazba_odeslana, not ${item.state}`)
            const receipt: Receipt = store.saveReceipt({ message_id: message.id, recipient_id: user.id, confirmed_at: now() })
            // Closing ends a hold; open tasks stay as they are.
            store.saveCase({ ...item, state: 'uzavreno', on_hold: null }); store.sync(item.id)
            store.record(item.id, user.id, now(), 'receipt_confirmed', `${transition('zpetna_vazba_odeslana', 'uzavreno')}${item.on_hold ? ', odložení zrušeno' : ''}`)
            return HttpResponse.json(receipt, { status: 201 })
        }),
    ]
}
