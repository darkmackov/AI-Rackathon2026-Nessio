import { HttpResponse } from 'msw'
import type { CaseState, HttpValidationError, OrganizationKind, QueueColumn, ValidationError } from '../client/types.gen'

// Exhaustive maps keep mock query enums aligned with the generated contract.
export const organizationKinds = { koc: true, clinic: true, laboratory: true, radiology: true, gp_practice: true, insurer: true } satisfies Record<OrganizationKind, true>
export const caseStates = { koncept: true, odeslano: true, v_triage: true, ceka_na_podklady: true, kompletni: true, pripraveno_k_mdt: true, zaver_mdt: true, zpetna_vazba_odeslana: true, uzavreno: true, vraceno_lekari: true } satisfies Record<CaseState, true>
export const queueColumns = { novy: true, aktivni: true, odlozeny: true } satisfies Record<QueueColumn, true>

export function validationResponse(errors: ValidationError[]) {
  return HttpResponse.json<HttpValidationError>({ detail: errors }, { status: 422 })
}

export function enumError(value: unknown, allowed: string[], loc: ValidationError['loc']): ValidationError {
  const quoted = allowed.map((item) => `'${item}'`)
  const expected = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0] ?? ''
  return { loc, type: 'enum', msg: `Input should be ${expected}`, input: value, ctx: { expected } }
}

// FastAPI uses the last value of a repeated scalar query parameter.
export function queryValue(query: URLSearchParams, name: string) {
  return query.getAll(name).at(-1) ?? null
}

export function validateEnumQuery(query: URLSearchParams, name: string, allowed: object): ValidationError[] {
  const value = queryValue(query, name)
  return value !== null && !Object.keys(allowed).includes(value)
    ? [enumError(value, Object.keys(allowed), ['query', name])]
    : []
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export async function objectBody(request: Request): Promise<{ value?: Record<string, unknown>; errors: ValidationError[] }> {
  const text = await request.text()
  if (!text) return { errors: [{ loc: ['body'], type: 'missing', msg: 'Field required', input: null }] }
  let value: unknown
  try { value = JSON.parse(text) }
  catch {
    return { errors: [{ loc: ['body', 0], type: 'json_invalid', msg: 'JSON decode error', input: {} }] }
  }
  if (!isObject(value)) {
    return { errors: [{ loc: ['body'], type: 'model_attributes_type', msg: 'Input should be a valid dictionary or object to extract fields from', input: value }] }
  }
  return { value, errors: [] }
}

export function extraFields(body: Record<string, unknown>, allowed: string[]): ValidationError[] {
  return Object.keys(body).filter((key) => !allowed.includes(key)).map((key) => ({
    loc: ['body', key], type: 'extra_forbidden', msg: 'Extra inputs are not permitted', input: body[key],
  }))
}

// ISO 8601 strings accepted by the documented datetime wire type, including offsets.
// Form input separately validates the computer-local time and DST gaps.
export function isApiDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:[Zz]|([+-])(\d{2}):(\d{2}))?$/.exec(value)
  if (!match) return false
  const [, year, month, day, hour, minute, second = '00', , offsetHour = '00', offsetMinute = '00'] = match
  if (Number(year) < 1 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false
  const calendar = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  return Number.isFinite(new Date(value).getTime()) &&
    calendar.getUTCFullYear() === Number(year) && calendar.getUTCMonth() + 1 === Number(month) &&
    calendar.getUTCDate() === Number(day) && calendar.getUTCHours() === Number(hour) &&
    calendar.getUTCMinutes() === Number(minute) && calendar.getUTCSeconds() === Number(second)
}
