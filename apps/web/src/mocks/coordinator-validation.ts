import { HttpResponse } from 'msw'
import type { ValidationError } from '../client/types.gen'
import { extraFields, isApiDateTime, objectBody, validationResponse } from './validation'

export function fail(status: number, detail: string): never { throw HttpResponse.json({ detail }, { status }) }
export function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
export class BodyReader {
  errors: ValidationError[] = []
  readonly value: Record<string, unknown>
  constructor(value: Record<string, unknown>, allowed: string[]) { this.value = value; this.errors = extraFields(value, allowed) }
  bad(key: string, message = 'Invalid value'): void { this.errors.push({ loc: ['body', key], type: 'value_error', msg: message }) }
  text(key: string, required = false): string | null | undefined {
    const value = this.value[key]
    if (value === undefined && !required) return undefined
    if (value === null && !required) return null
    if (typeof value !== 'string' || (required && !value.trim())) { this.bad(key, 'A non-empty string is required'); return undefined }
    return value.trim()
  }
  pick<T extends string>(key: string, choices: readonly T[], fallback: T): T {
    const value = this.value[key]
    if (value === undefined) return fallback
    const result = choices.find((choice) => choice === value)
    if (!result) this.bad(key, 'Invalid choice')
    return result ?? fallback
  }
  date(key: string, time = false) {
    const value = this.text(key)
    if (value && !(time ? isApiDateTime(value) : /^\d{4}-\d{2}-\d{2}$/.test(value) && isApiDateTime(`${value}T00:00:00`))) this.bad(key, 'Invalid date')
    return value
  }
  flag(key: string, fallback = false) {
    const value = this.value[key]
    if (value === undefined) return fallback
    if (typeof value !== 'boolean') this.bad(key, 'A boolean is required')
    return value === true
  }
  list(key: string): string[] {
    const value = this.value[key]
    if (value === undefined) return []
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string' && !!item.trim())) { this.bad(key, 'A list of strings is required'); return [] }
    return value
  }
  done() { if (this.errors.length) throw validationResponse(this.errors) }
}
export async function readBody(request: Request, allowed: string[]) {
  const parsed = await objectBody(request)
  if (!parsed.value) throw validationResponse(parsed.errors)
  return new BodyReader(parsed.value, allowed)
}
export function validateGraph(items: { key: string; depends_on?: string[] }[]) {
  const graph = new Map(items.map((item) => [item.key, item.depends_on ?? []]))
  if (graph.size !== items.length) fail(400, 'duplicate dependency key')
  const visiting = new Set<string>(), visited = new Set<string>()
  function visit(key: string) {
    if (!graph.has(key)) fail(400, 'dependency not found in this case or task set')
    if (visiting.has(key)) fail(400, 'dependency cycle')
    if (visited.has(key)) return
    visiting.add(key)
    for (const dependency of graph.get(key) ?? []) visit(dependency)
    visiting.delete(key); visited.add(key)
  }
  for (const key of graph.keys()) visit(key)
}
