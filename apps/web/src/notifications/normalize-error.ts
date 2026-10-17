import { ApiError } from '../api-error'
import type { HttpValidationError, ValidationError } from '../client/types.gen'

export type FieldProblem = { path: string; messageKey: string }
export type UserProblem = { severity: 'error' | 'warning'; code: string; messageKey: string; fields: FieldProblem[] }

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validationEntry(value: unknown): value is ValidationError {
    return isRecord(value) && Array.isArray(value.loc) && value.loc.every((part) => typeof part === 'string' || typeof part === 'number') && typeof value.type === 'string' && typeof value.msg === 'string'
}

export function validationBody(value: unknown): value is HttpValidationError & { detail: ValidationError[] } {
    return isRecord(value) && Array.isArray(value.detail) && value.detail.every(validationEntry)
}

const reasons: Record<string, string> = {
    'dependency cycle': 'cycle',
    'the dependencies form a cycle': 'cycle',
    "the steps' dependencies form a cycle": 'cycle',
    'duplicate dependency key': 'duplicateKey',
    'step keys must be unique': 'duplicateKey',
    'dependency not found in this case or task set': 'missingDependency',
    'result document must belong to this case': 'wrongDocument',
    'not a document of this case': 'wrongDocument',
    'task set already started for this case': 'duplicateSet',
    'the task set already runs on this case': 'duplicateSet',
    'transition is not allowed': 'invalidTransition',
    'case is not editable before MDT': 'locked',
    'confirm the MDT conclusion before sending it': 'notConfirmed',
    'the conclusion has no text': 'conclusionText',
    'the uploaded MDT report is missing': 'conclusionFile',
    "the referring doctor hasn't validated the handover": 'notValidated',
    'validate the handover again after the return': 'notValidated',
    'no embedding model is configured': 'codesUnavailable',
    'the MKN-10 code list is not loaded': 'codesUnavailable',
    'the handover has no diagnosis': 'diagnosisRequired',
    'the diagnosis already has a code': 'codeExists',
    'stale': 'staleCodes',
    'not one of the suggested codes': 'staleCodes',
    'receipt already confirmed': 'alreadyConfirmed',
    'Only a recipient can confirm receipt': 'notRecipient',
    'only a coordinator of the case\'s KOC': 'wrongKoc',
    'only the referring doctor of this case': 'wrongReferrer',
    'unknown KOC': 'unknownKoc',
    'unknown MDT board': 'unknownBoard',
    "not an MDT board of the case's KOC": 'unknownBoard',
    'supported files: .docx, .pptx, .pdf': 'fileType',
}

function knownReason(detail: unknown) {
    if (typeof detail !== 'string') return undefined
    if (reasons[detail]) return reasons[detail]
    if (/^[A-Z][0-9]{2}(?:\.[0-9A-Z]+)? is not one of the suggested codes$/u.test(detail)) return 'staleCodes'
    if (/^unresolved blockers: /u.test(detail)) return 'blockers'
    if (/^documents still processing: /u.test(detail)) return 'processing'
    if (/^the handover uses documents received after /u.test(detail)) return 'lateDocuments'
    if (/^unknown dependencies: |^step .*: unknown dependencies /u.test(detail)) return 'missingDependency'
    if (/^no owner for: |^unknown owner: /u.test(detail)) return 'ownerRequired'
    if (/^cannot read the file: |^cannot read the Bundle: |^cannot read .*: /u.test(detail)) return 'fileUnreadable'
    if (/^finding .* can't be overridden$/u.test(detail)) return 'overrideForbidden'
    if (/^handover can't be |^the MDT record can't be changed|^the MDT conclusion can't be changed|^tasks can't be changed/u.test(detail)) return 'locked'
    if (/ is not a manual move$/u.test(detail)) return 'invalidTransition'
    if (/^the feedback is sent from zaver_mdt, not (zpetna_vazba_odeslana|uzavreno)$/u.test(detail)) return 'alreadySent'
    return undefined
}

export function normalizeError(error: unknown): UserProblem {
    const problem = (code: string, severity: UserProblem['severity'] = 'error', fields: FieldProblem[] = []): UserProblem => ({ code, severity, messageKey: `notices.${code}`, fields })
    if (!(error instanceof ApiError)) return problem('unexpected')
    if (error.status === undefined) return problem(error.detail instanceof DOMException && error.detail.name === 'TimeoutError' ? 'timeout' : 'network')
    if (validationBody(error.detail)) {
        const fields = error.detail.detail.filter((entry) => entry.loc[0] === 'body' && entry.loc.length > 1).map((entry) => ({
            path: entry.loc.slice(1).join('.'),
            messageKey: entry.type === 'missing' || entry.type === 'string_too_short' ? 'notices.requiredField' : 'notices.invalidField',
        }))
        return problem('validation', 'warning', fields)
    }
    const reason = knownReason(isRecord(error.detail) ? error.detail.detail : undefined)
    if (reason) return problem(reason, reason === 'codesUnavailable' ? 'error' : 'warning')
    switch (error.status) {
        case 400: return problem('badInput', 'warning')
        case 403: return problem('forbidden', 'warning')
        case 404: return problem('notFound')
        case 409: return problem('conflict', 'warning')
        case 415: return problem('fileType', 'warning')
        case 422: return problem('validation', 'warning')
        case 501: return problem('notImplemented')
        case 502: case 503: return problem('unavailable')
        case 504: return problem('timeout')
        default: return problem(error.status >= 500 ? 'server' : 'unexpected')
    }
}