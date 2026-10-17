import { actorHeaders } from '../api'
import * as api from '../client/@tanstack/react-query.gen'
import { mutation } from './mdt-fixtures'
import { demoState } from './setup'

export const referenceId = 'vzp-prochazkova'

/** The reference case through the S5 endpoints: MDT input, written conclusion and, by default, its confirmation. */
export async function concludeReference(confirmIt = true) {
  const headers = actorHeaders('koordinator'), path = { case_id: referenceId }
  const result = demoState.documents.result(referenceId)
  if (!result) throw new Error('Missing reference handover')
  demoState.documents.saveResult(referenceId, { ...result, findings: result.findings.map((finding) => finding.severity === 'blocker' ? { ...finding, resolved: true, resolution: { kind: 'overridden', note: 'Fiktivní rozhodnutí koordinátora.', by: 'koordinator', at: '2026-10-21T08:30:00' } } : finding) })
  await mutation(api.createMdtSnapshotMutation(), { headers, path, body: { board_id: 'mdt-git-lipova', mdt_date: '2026-10-21' } })
  await mutation(api.upsertMdtConclusionMutation(), { headers, path, body: { conclusion: 'Fiktivní závěr MDT.', recommendations: ['Fiktivní doporučení.'], date: '2026-10-21' } })
  if (confirmIt) await mutation(api.confirmMdtConclusionMutation(), { headers, path })
}
