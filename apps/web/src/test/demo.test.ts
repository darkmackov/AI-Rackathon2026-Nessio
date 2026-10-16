/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ApiError, createQueryClient } from '../api'
import { getDemoClockOptions, getMdtBoardOptions, listActorsOptions, listCasesOptions, listMdtBoardsOptions, listOrganizationsOptions, meOptions, resetDemoMutation, setDemoClockMutation } from '../client/@tanstack/react-query.gen'
import { resources } from '../i18n'
import { actors, boards, organizations } from '../mocks/directory'
import { createDemoState } from '../mocks/handlers'
import { localDateTime, validLocalDateTime } from '../time'

describe('demo HTTP contract and clock', () => {
  it('advances simulated time at real speed and supports real time and both resets', () => {
    let now = new Date(2030, 0, 1).getTime()
    const state = createDemoState(() => now)
    expect(state.clock()).toEqual({ now: '2026-10-21T09:00:00', simulated: true })
    now += 90_000
    expect(state.clock().now).toBe('2026-10-21T09:01:30')
    expect(state.reset('empty')).toEqual([])
    expect(state.clock().now).toBe('2026-10-02T14:00:00')
    state.setTime(null)
    expect(state.clock()).toEqual({ now: localDateTime(new Date(now)), simulated: false })
    expect(state.reset('reference_at_mdt')).toHaveLength(1)
    expect(state.clock().now).toBe('2026-10-21T09:00:00')
  })

  it('keeps independent demo sessions and returns copies of data', () => {
    const first = createDemoState()
    const second = createDemoState()
    first.reset('empty')
    expect(second.getCases()).toHaveLength(1)
    const data = second.getCases()
    data.length = 0
    expect(second.getCases()).toHaveLength(1)
  })

  it('serves directory filters and stable response models through generated query helpers', async () => {
    const client = createQueryClient()
    expect(await client.fetchQuery(listActorsOptions({ query: { role: 'coordinator' } }))).toHaveLength(5)
    expect(await client.fetchQuery(listActorsOptions({ query: { role: 'referring_doctor' } }))).toHaveLength(5)
    expect(await client.fetchQuery(listOrganizationsOptions({ query: { kind: 'koc' } }))).toHaveLength(5)
    expect(await client.fetchQuery(listMdtBoardsOptions())).toHaveLength(5)
    expect(await client.fetchQuery(getMdtBoardOptions({ path: { board_id: 'mdt-git-lipova' } }))).toMatchObject({ organization_id: 'koc2-lipova' })
    await expect(client.fetchQuery(meOptions({ headers: { 'X-Actor-Id': 'not-a-person' } }))).rejects.toMatchObject({ status: 404 })
    await expect(client.fetchQuery(meOptions({ headers: { 'X-Actor-Id': 'pato-pokorny' } }))).rejects.toMatchObject({ status: 403 })
  })

  it('mutates scenarios and clock through existing generated helpers', async () => {
    const client = createQueryClient()
    const reset = client.getMutationCache().build(client, resetDemoMutation())
    expect(await reset.execute({ body: { scenario: 'empty' } })).toEqual([])
    expect(await client.fetchQuery(listCasesOptions())).toEqual([])
    const set = client.getMutationCache().build(client, setDemoClockMutation())
    expect(await set.execute({ body: { now: '2026-10-27T10:30:00' } })).toMatchObject({ simulated: true })
    expect(await client.fetchQuery(getDemoClockOptions())).toMatchObject({ now: expect.stringMatching(/^2026-10-27T10:30/) })
    expect(await reset.execute({ body: { scenario: 'reference_at_mdt' } })).toHaveLength(1)
    await expect(set.execute({ body: { now: 'invalid-date' } })).rejects.toBeInstanceOf(ApiError)
  })

  it('matches the canonical demo directory and has the same translation keys in both languages', () => {
    const directory = JSON.parse(readFileSync('../../data/demo/directory.json', 'utf8'))
    expect({ actors, organizations, mdt_boards: boards }).toEqual({ actors: directory.actors, organizations: directory.organizations, mdt_boards: directory.mdt_boards })
    const paths = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, nested]) =>
      typeof nested === 'object' && nested ? paths(nested, `${prefix}${key}.`) : [`${prefix}${key}`])
    expect(paths(resources.cs.translation)).toEqual(paths(resources.en.translation))
  })

  it('validates local datetimes without accepting invalid dates or UTC conversions', () => {
    expect(validLocalDateTime('2026-10-21T09:00')).toBe(true)
    expect(validLocalDateTime('2026-02-30T09:00')).toBe(false)
    expect(validLocalDateTime('2026-10-21T09:00:00Z')).toBe(false)
    expect(validLocalDateTime('')).toBe(false)
  })
})
