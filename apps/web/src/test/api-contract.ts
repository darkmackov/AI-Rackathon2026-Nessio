/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect } from 'vitest'

const document: unknown = JSON.parse(readFileSync('openapi.json', 'utf8'))

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function field(value: unknown, key: string): unknown {
  if (!object(value)) throw new Error(`Expected an OpenAPI object containing ${key}`)
  return value[key]
}

function responseSchema(operationId: string, status: number): unknown {
  const paths = field(document, 'paths')
  if (!object(paths)) throw new Error('Missing OpenAPI paths')
  for (const path of Object.values(paths)) {
    if (!object(path)) continue
    for (const operation of Object.values(path)) {
      if (!object(operation) || operation.operationId !== operationId) continue
      return field(field(field(field(field(operation, 'responses'), String(status)), 'content'), 'application/json'), 'schema')
    }
  }
  throw new Error(`Missing documented response ${operationId} ${status}`)
}

// An independent, deliberately bounded checker for the schema constructs used by S0.
// It checks the committed OpenAPI, not a second handwritten set of API models.
function check(value: unknown, schema: unknown): void {
  if (!object(schema)) throw new Error('Missing OpenAPI schema')
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.split('/').at(-1) ?? ''
    return check(value, field(field(field(document, 'components'), 'schemas'), name))
  }
  if (Array.isArray(schema.anyOf)) {
    const matches = schema.anyOf.some((variant: unknown) => {
      try { check(value, variant); return true } catch { return false }
    })
    expect(matches, `Value does not match ${schema.title ?? 'anyOf'}`).toBe(true)
    return
  }
  if (Array.isArray(schema.enum)) expect(schema.enum).toContain(value)
  switch (schema.type) {
    case 'null': expect(value).toBeNull(); return
    case 'boolean': expect(typeof value).toBe('boolean'); return
    case 'integer': expect(typeof value === 'number' && Number.isInteger(value)).toBe(true); return
    case 'number': expect(typeof value === 'number' && Number.isFinite(value)).toBe(true); return
    case 'string': {
      expect(typeof value).toBe('string')
      if (typeof value !== 'string') return
      if (schema.format === 'date') {
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(new Date(value).toISOString().slice(0, 10)).toBe(value)
      } else if (schema.format === 'date-time') {
        // The current backend intentionally emits naive ISO datetimes (Q-K8).
        expect(value).toMatch(/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}/)
        expect(Number.isFinite(new Date(value).getTime())).toBe(true)
      } else if (schema.format !== undefined) throw new Error(`Unsupported format: ${schema.format}`)
      return
    }
    case 'array': {
      expect(Array.isArray(value)).toBe(true)
      if (Array.isArray(value)) value.forEach((item: unknown) => check(item, schema.items))
      return
    }
    case 'object': {
      expect(object(value)).toBe(true)
      if (!object(value)) return
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) { expect(typeof key).toBe('string'); expect(Object.keys(value)).toContain(key) }
      }
      const properties = object(schema.properties) ? schema.properties : {}
      for (const [key, nested] of Object.entries(value)) {
        if (Object.hasOwn(properties, key)) check(nested, properties[key])
        else if (schema.additionalProperties === false) throw new Error(`Undocumented field ${key}`)
        else if (object(schema.additionalProperties)) check(nested, schema.additionalProperties)
      }
      return
    }
    case undefined: return // An unconstrained field such as ValidationError.input.
    default: throw new Error(`Unsupported OpenAPI type: ${schema.type}`)
  }
}

export function expectApiResponse(operationId: string, status: number, value: unknown) {
  check(value, responseSchema(operationId, status))
}
