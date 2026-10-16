import { describe, expect, it } from 'vitest'
import { resources } from '../i18n'

describe('translations', () => {
  it('has the same keys in Czech and English', () => {
    const paths = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, nested]) =>
      typeof nested === 'object' && nested ? paths(nested, `${prefix}${key}.`) : [`${prefix}${key}`])
    expect(paths(resources.cs.translation)).toEqual(paths(resources.en.translation))
  })
})
