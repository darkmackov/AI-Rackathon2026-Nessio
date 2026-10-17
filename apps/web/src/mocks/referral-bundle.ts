import { http, HttpResponse } from 'msw'
import type { Case } from '../client/types.gen'
import { documentFormats, uploadMime } from '../components/documents/document-utils'
import { actors, organizations } from './directory'
import type { createDemoState } from './handlers'
import { validationResponse } from './validation'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const fail = (status: number, detail: string): never => { throw HttpResponse.json({ detail }, { status }) }

// Only the MSW HTTP boundary reads the exchange envelope. No FHIR values become clinical data.
// PDF/Office parsing and AI are simulated by the existing S2 fixtures, not performed in the browser.
function attachments(bundle: unknown): File[] {
  if (!object(bundle) || bundle.resourceType !== 'Bundle') return fail(422, 'not a FHIR Bundle')
  const entries = bundle.entry ?? []
  if (!Array.isArray(entries)) return fail(422, 'Bundle.entry must be a list')
  const binaries = new Map<string, Record<string, unknown>>()
  for (const entry of entries) {
    if (!object(entry) || !object(entry.resource) || entry.resource.resourceType !== 'Binary') continue
    if (typeof entry.fullUrl === 'string') binaries.set(entry.fullUrl, entry.resource)
    if (typeof entry.resource.id === 'string') binaries.set(`Binary/${entry.resource.id}`, entry.resource)
  }
  const files: File[] = []
  for (const entry of entries) {
    if (!object(entry) || !object(entry.resource)) continue
    const resource = entry.resource
    const values = resource.resourceType === 'DocumentReference' ? resource.content : resource.resourceType === 'DiagnosticReport' ? resource.presentedForm : []
    for (const item of Array.isArray(values) ? values : []) {
      if (!object(item)) continue
      const attachment = resource.resourceType === 'DocumentReference' ? item.attachment ?? item : item
      if (!object(attachment)) continue
      const binary = typeof attachment.url === 'string' ? binaries.get(attachment.url) : undefined
      const encoded = attachment.data ?? binary?.data
      if (typeof encoded !== 'string' || !encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return fail(422, 'attachment has no valid inline data or local Binary')
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      const filename = String(attachment.title || resource.description || `priloha-${files.length + 1}`)
      const declared = attachment.contentType ?? binary?.contentType
      const mime = Object.values(documentFormats).find((value) => value === declared) ?? uploadMime(new File([], filename))
      if (!mime) return fail(415, 'unsupported attachment format')
      files.push(new File([bytes], filename, { type: mime }))
    }
  }
  if (!files.length) return fail(400, 'the Bundle carries no documents')
  return files
}

export function createReferralBundleHandlers(state: ReturnType<typeof createDemoState>) {
  let sequence = 0
  return [http.post('*/api/referrals/fhir', async ({ request }) => {
    const actorId = request.headers.get('X-Actor-Id')
    if (actorId === null) return validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }])
    const actor = actors.find((item) => item.id === actorId)
    if (!actor) return HttpResponse.json({ detail: 'actor not found' }, { status: 404 })
    if (actor.role !== 'referring_doctor') return HttpResponse.json({ detail: 'only a referring doctor can refer' }, { status: 403 })
    try {
      const form = await request.formData()
      const file = form.get('file')
      const kocId = form.get('koc_id')
      const errors = [
        ...(file === null || typeof file === 'string' ? [{ loc: ['body', 'file'], type: 'missing', msg: 'File required' }] : []),
        ...(typeof kocId !== 'string' ? [{ loc: ['body', 'koc_id'], type: 'missing', msg: 'KOC required' }] : []),
      ]
      if (errors.length || !file || typeof file === 'string') return validationResponse(errors)
      const koc = organizations.find((item) => item.id === kocId && item.kind === 'koc')
      if (!koc) return fail(400, 'unknown KOC')
      let bundle: unknown
      try { bundle = JSON.parse(await file.text()) } catch { return fail(422, 'invalid JSON') }
      const files = attachments(bundle)
      // Validate the entire envelope before saving anything: rejected imports leave no partial case.
      let id: string
      do { id = `demo-fhir-${++sequence}` } while (state.getCases().some((item) => item.id === id))
      const now = state.clock().now
      const item: Case = { id, patient_name: '', koc_id: koc.id, referring_doctor_id: actor.id, state: 'odeslano', queue: 'novy', priority: 'normal', created_at: now, milestones: { referred_at: now } }
      state.saveCase(item)
      state.documents.saveHandover({ case_id: id, as_of: now.slice(0, 10) })
      state.coordinator.record(id, actor.id, now, 'referral_created', `${koc.name}, FHIR Bundle`)
      for (const attachment of files) {
        state.documents.upload(id, attachment, actor.id, now, now)
        state.coordinator.record(id, actor.id, now, 'document_uploaded', attachment.name)
      }
      state.coordinator.sync(id)
      return HttpResponse.json<Case>(state.getCases().find((entry) => entry.id === id) ?? item, { status: 201 })
    } catch (error) {
      if (error instanceof Response) return error
      return HttpResponse.json({ detail: 'invalid multipart' }, { status: 400 })
    }
  })]
}
