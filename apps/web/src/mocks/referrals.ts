import { http, HttpResponse } from 'msw'
import type { Case, Handover, Message, SourcedStr, Stamp } from '../client/types.gen'
import { validDocumentDate } from '../components/documents/document-utils'
import { actors, organizations } from './directory'
import { auditDate, handoverLabels, transition } from './audit-text'
import type { createDemoState } from './handlers'
import { extraFields, objectBody, validationResponse } from './validation'

// User-authorized S3 simulation at the HTTP boundary. Screens use the real generated client.
type DemoState = ReturnType<typeof createDemoState>
const patientStrings = ['first_name', 'last_name', 'birth_number', 'sex', 'insurance_code', 'address'] as const
const contactStrings = ['patient_phone', 'patient_email', 'contact_person', 'contact_person_phone'] as const
const handoverStrings = ['diagnosis', 'diagnosis_code', 'epicrisis_source', 'epicrisis', 'mdt_question', 'allergies', 'performance_status', 'symptoms', 'histology', 'other'] as const
const badValue = () => validationResponse([{ loc: ['body', 'value'], type: 'value_error', msg: 'Invalid value' }])
const fail = (detail: string, status: number) => HttpResponse.json({ detail }, { status })

function updateField(handover: Handover, path: string, value: unknown, unavailable: boolean, note: string | null, entered: Stamp): Handover | undefined {
  const base = { status: unavailable ? 'missing' : 'found', origin: 'manual', entered, note } as const
  const actual = unavailable ? null : value
  const patientKey = patientStrings.find((key) => path === `patient.${key}`)
  const contactKey = contactStrings.find((key) => path === `contacts.${key}`)
  const stringKey = handoverStrings.find((key) => path === key)
  if (patientKey || contactKey || stringKey || path === 'patient.birth_date') {
    if (actual !== null && typeof actual !== 'string') return undefined
    if (path === 'patient.birth_date' && actual !== null && !validDocumentDate(actual)) return undefined
    const field: SourcedStr = { ...base, value: actual }
    if (patientKey) return { ...handover, patient: { ...handover.patient, [patientKey]: field } }
    if (contactKey) return { ...handover, contacts: { ...handover.contacts, [contactKey]: field } }
    if (stringKey) return { ...handover, [stringKey]: field }
    return { ...handover, patient: { ...handover.patient, birth_date: field } }
  }
  if (path === 'comorbidities' || path === 'medications') {
    if (actual !== null && (!Array.isArray(actual) || !actual.every((item): item is string => typeof item === 'string'))) return undefined
    return { ...handover, [path]: { ...base, value: actual } }
  }
  if (path === 'patient.age' || path === 'weight_kg' || path === 'height_cm') {
    if (actual !== null && (typeof actual !== 'number' || !Number.isFinite(actual) || (path === 'patient.age' && !Number.isInteger(actual)))) return undefined
    const field = { ...base, value: actual }
    return path === 'patient.age' ? { ...handover, patient: { ...handover.patient, age: field } } : { ...handover, [path]: field }
  }
  return undefined
}

export function createReferralHandlers(state: DemoState) {
  let sequence = 0
  const currentUser = (request: Request) => {
    const id = request.headers.get('X-Actor-Id')
    if (id === null) return { error: validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }]) }
    const actor = actors.find((entry) => entry.id === id)
    if (!actor) return { error: fail('actor not found', 404) }
    if (actor.role !== 'referring_doctor' && actor.role !== 'coordinator') return { error: fail('wrong role', 403) }
    return { actor, error: null }
  }
  // The backend's `_require_editor`: the case's GP or a coordinator of its KOC, each only in their own states.
  const editableStates: Record<string, string[]> = { referring_doctor: ['koncept', 'vraceno_lekari'], coordinator: ['v_triage', 'ceka_na_podklady', 'kompletni'] }
  const context = (request: Request, id: string, referrerOnly = false) => {
    const user = currentUser(request)
    if (user.error) return { error: user.error }
    const item = state.getCases().find((item) => item.id === id)
    const actor = user.actor
    if (!item) return { error: fail('case not found', 404) }
    if (actor.role === 'referring_doctor' ? actor.id !== item.referring_doctor_id : referrerOnly || actor.organization_id !== item.koc_id) {
      return { error: fail(referrerOnly ? 'only the referring doctor of this case' : 'only the referring doctor or a coordinator of the case\'s KOC', 403) }
    }
    if (!editableStates[actor.role]?.includes(item.state ?? '')) return { error: fail(actor.role === 'coordinator' ? 'case is not editable before MDT' : 'referral is not editable', 409) }
    const handover = state.documents.result(id)?.handover
    if (!handover) return { error: fail('no handover yet', 404) }
    return { item, actor, handover, error: null }
  }
  const saveHandover = (item: Case, handover: Handover, actorId: string, action: string, detail?: string) => {
    state.documents.saveHandover(handover)
    const name = [handover.patient?.first_name?.value, handover.patient?.last_name?.value].filter(Boolean).join(' ')
    state.saveCase({ ...item, patient_name: name || item.patient_name, diagnosis_label: handover.diagnosis?.value || item.diagnosis_label })
    state.coordinator.record(item.id, actorId, state.clock().now, action, detail)
  }
  return [
    http.post('*/api/referrals', async ({ request }) => {
      const user = currentUser(request)
      if (user.error) return user.error
      const actor = user.actor
      if (actor.role !== 'referring_doctor') return fail('only a referring doctor can create a referral', 403)
      const parsed = await objectBody(request)
      if (!parsed.value) return validationResponse(parsed.errors)
      const errors = extraFields(parsed.value, ['koc_id'])
      if (typeof parsed.value.koc_id !== 'string') errors.push({ loc: ['body', 'koc_id'], type: 'string_type', msg: 'KOC required' })
      if (errors.length) return validationResponse(errors)
      const koc = organizations.find((item) => item.id === parsed.value?.koc_id && item.kind === 'koc')
      if (!koc) return fail('KOC not found', 404)
      let id: string
      do { id = `demo-referral-${++sequence}` } while (state.getCases().some((item) => item.id === id))
      const now = state.clock().now
      const item: Case = { id, patient_name: '', koc_id: koc.id, referring_doctor_id: actor.id, state: 'koncept', queue: 'novy', priority: 'normal', created_at: now }
      state.saveCase(item)
      state.documents.saveHandover({ case_id: id, as_of: now.slice(0, 10) })
      state.coordinator.record(id, actor.id, now, 'referral_created', koc.name)
      return HttpResponse.json<Case>(item, { status: 201 })
    }),
    http.patch('*/api/cases/:caseId/handover', async ({ request, params }) => {
      const found = context(request, String(params.caseId))
      if (found.error) return found.error
      const parsed = await objectBody(request)
      if (!parsed.value) return validationResponse(parsed.errors)
      const body = parsed.value
      const errors = extraFields(body, ['path', 'value', 'not_available', 'note'])
      if (typeof body.path !== 'string') errors.push({ loc: ['body', 'path'], type: 'string_type', msg: 'Path required' })
      if (body.not_available !== undefined && typeof body.not_available !== 'boolean') errors.push({ loc: ['body', 'not_available'], type: 'bool_type', msg: 'Boolean required' })
      if (body.note != null && typeof body.note !== 'string') errors.push({ loc: ['body', 'note'], type: 'string_type', msg: 'Note must be text' })
      if (errors.length || typeof body.path !== 'string') return validationResponse(errors)
      if (![...patientStrings.map((key) => `patient.${key}`), ...contactStrings.map((key) => `contacts.${key}`), ...handoverStrings, 'patient.birth_date', 'patient.age', 'comorbidities', 'medications', 'weight_kg', 'height_cm'].includes(body.path)) return fail('not an editable handover field', 400)
      if (body.not_available !== true && body.value == null) return fail('give a value or not_available', 400)
      const handover = updateField(found.handover, body.path, body.value, body.not_available === true, typeof body.note === 'string' ? body.note : null, { by: found.actor.id, at: state.clock().now })
      if (!handover) return badValue()
      saveHandover(found.item, handover, found.actor.id, 'handover_field_updated', `${handoverLabels[body.path] ?? body.path}${body.not_available === true ? ': není k dispozici' : ''}`)
      return HttpResponse.json<Handover>(handover)
    }),
    http.post('*/api/cases/:caseId/handover/examinations', async ({ request, params }) => {
      const found = context(request, String(params.caseId))
      if (found.error) return found.error
      const parsed = await objectBody(request)
      if (!parsed.value) return validationResponse(parsed.errors)
      const { date, place, type, result_full_text } = parsed.value
      const errors = extraFields(parsed.value, ['date', 'place', 'type', 'result_full_text'])
      if (errors.length) return validationResponse(errors)
      if (typeof date !== 'string' || !validDocumentDate(date) || typeof place !== 'string' || typeof type !== 'string' || typeof result_full_text !== 'string') return badValue()
      const handover: Handover = { ...found.handover, examinations: [...(found.handover.examinations ?? []), { date, place, type, result_full_text, origin: 'manual', entered: { by: found.actor.id, at: state.clock().now } }] }
      saveHandover(found.item, handover, found.actor.id, 'examination_added', `${auditDate(date)} ${type}`)
      return HttpResponse.json<Handover>(handover, { status: 201 })
    }),
    http.post('*/api/cases/:caseId/handover/validate', ({ request, params }) => {
      const found = context(request, String(params.caseId), true)
      if (found.error) return found.error
      const handover: Handover = { ...found.handover, validated_by_referrer: { by: found.actor.id, at: state.clock().now } }
      saveHandover(found.item, handover, found.actor.id, 'handover_validated')
      return HttpResponse.json<Handover>(handover)
    }),
    http.post('*/api/cases/:caseId/send', ({ request, params }) => {
      const found = context(request, String(params.caseId), true)
      if (found.error) return found.error
      if (!found.handover.validated_by_referrer) return fail('validate the handover first', 409)
      const returnedAt = state.getMessages().filter((message) => message.case_id === found.item.id && message.kind === 'case_returned').map((message) => message.sent_at ?? '').sort().at(-1)
      if (found.item.state === 'vraceno_lekari' && returnedAt && found.handover.validated_by_referrer.at <= returnedAt) return fail('validate the handover again after the return', 409)
      const item: Case = { ...found.item, state: found.item.state === 'vraceno_lekari' ? 'v_triage' : 'odeslano',
        milestones: { ...found.item.milestones, referred_at: found.item.milestones?.referred_at ?? state.clock().now } }
      state.saveCase(item)
      // Queue, owner and next step are recomputed like after any other workflow change.
      state.coordinator.sync(item.id)
      state.coordinator.record(item.id, found.actor.id, state.clock().now, 'referral_sent', transition(found.item.state, item.state))
      return HttpResponse.json<Case>(state.getCases().find((entry) => entry.id === item.id) ?? item)
    }),
    http.get('*/api/inbox', ({ request }) => {
      const user = currentUser(request)
      if (user.error) return user.error
      return HttpResponse.json<Message[]>(state.getMessages().filter((message) => message.recipient_ids.includes(user.actor.id)))
    }),
  ]
}
