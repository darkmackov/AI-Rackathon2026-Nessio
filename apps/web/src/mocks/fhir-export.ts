import { http, HttpResponse } from 'msw'
import { actors } from './directory'
import type { createDemoState } from './handlers'
import { validationResponse } from './validation'

// User-authorized S9 HTTP fixture. It is a labelled sample file, never a clinical projection.
export function createFhirExportHandlers(state: ReturnType<typeof createDemoState>) {
  return [http.get('*/api/cases/:caseId/fhir', ({ request, params }) => {
    const actorId = request.headers.get('X-Actor-Id')
    if (actorId === null) return validationResponse([{ loc: ['header', 'X-Actor-Id'], type: 'missing', msg: 'Field required' }])
    const actor = actors.find((item) => item.id === actorId)
    if (!actor) return HttpResponse.json({ detail: 'actor not found' }, { status: 404 })
    if (!['referring_doctor', 'coordinator'].includes(actor.role)) return HttpResponse.json({ detail: 'wrong role' }, { status: 403 })
    const item = state.getCases().find((item) => item.id === params.caseId)
    if (!item) return HttpResponse.json({ detail: 'case not found' }, { status: 404 })
    if (!(actor.role === 'coordinator' && actor.organization_id === item.koc_id) && !(actor.role === 'referring_doctor' && actor.id === item.referring_doctor_id)) {
      return HttpResponse.json({ detail: 'wrong case' }, { status: 403 })
    }
    const bundle = { resourceType: 'Bundle', type: 'collection', identifier: { system: 'urn:onko:demo:case', value: item.id },
      meta: { tag: [{ system: 'urn:onko:demo', code: 'fictional', display: 'FIKTIVNÍ UKÁZKA – neobsahuje klinická data případu.' }] },
      entry: [] }
    return new HttpResponse(JSON.stringify(bundle, null, 2), { headers: {
      'Content-Type': 'application/fhir+json', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`case-${item.id}.fhir.json`)}`,
    } })
  })]
}
