import { describe, expect, it } from 'vitest'
import { gameReducer, initialGame, placeFish, stepMs, type GameAction, type GameState } from '../components/nessie-game/game'

const run = (state: GameState, ...actions: GameAction[]) => actions.reduce(gameReducer, state)
const tick: GameAction = { type: 'tick', random: 0 }
// A 6×4 lake with Nessie at (2,1) heading right and the fish far away in the corner.
const lake = (overrides: Partial<GameState> = {}): GameState => ({
  cols: 6, rows: 4, body: [{ x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }], direction: 'right', turns: [], fish: { x: 5, y: 3 }, score: 0, status: 'running', ...overrides,
})

describe('Nessie game rules', () => {
  it('starts ready and only moves once started', () => {
    const ready = initialGame(0)
    expect(ready.status).toBe('ready')
    expect(run(ready, tick)).toBe(ready)
    expect(run(ready, { type: 'start' }, tick).body[0]).toEqual({ x: ready.body[0].x + 1, y: ready.body[0].y })
  })

  it('moves one cell per tick and keeps its length', () => {
    const next = run(lake(), tick)
    expect(next.body).toEqual([{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }])
  })

  it.each([
    ['right', { x: 5, y: 1 }, { x: 0, y: 1 }],
    ['left', { x: 0, y: 1 }, { x: 5, y: 1 }],
    ['down', { x: 2, y: 3 }, { x: 2, y: 0 }],
    ['up', { x: 2, y: 0 }, { x: 2, y: 3 }],
  ] as const)('wraps around the %s edge', (direction, head, expected) => {
    const state = lake({ body: [head], direction })
    expect(run(state, tick).body[0]).toEqual(expected)
  })

  it('ignores reversing into itself and queues at most two turns', () => {
    expect(run(lake(), { type: 'turn', direction: 'left' }).turns).toEqual([])
    const queued = run(lake(), { type: 'turn', direction: 'up' }, { type: 'turn', direction: 'left' }, { type: 'turn', direction: 'down' })
    expect(queued.turns).toEqual(['up', 'left'])
    const moved = run(queued, tick, tick)
    expect(moved.direction).toBe('left')
    expect(moved.body[0]).toEqual({ x: 1, y: 0 })
  })

  it('eats a fish: grows, scores and places a new fish off its body', () => {
    const next = run(lake({ fish: { x: 3, y: 1 } }), { type: 'tick', random: 0 })
    expect(next.score).toBe(1)
    expect(next.body).toHaveLength(4)
    expect(next.body).not.toContainEqual(next.fish)
    expect(next.fish).toEqual({ x: 0, y: 0 })
  })

  it('places fish only on free cells, using the given random value', () => {
    const body = [{ x: 0, y: 0 }, { x: 1, y: 0 }]
    expect(placeFish(2, 2, body, 0)).toEqual({ x: 0, y: 1 })
    expect(placeFish(2, 2, body, 0.99)).toEqual({ x: 1, y: 1 })
  })

  it('ends the game when Nessie bites herself, but may follow her own tail', () => {
    const coiled = lake({ body: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 1 }, { x: 3, y: 0 }], direction: 'up' })
    expect(run(coiled, { type: 'turn', direction: 'right' }, tick).status).toBe('over')
    const square = lake({ body: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 1 }], direction: 'up' })
    const chased = run(square, { type: 'turn', direction: 'right' }, tick)
    expect(chased.status).toBe('running')
    expect(chased.body[0]).toEqual({ x: 3, y: 1 })
  })

  it('pauses, resumes and restarts', () => {
    const paused = run(lake(), { type: 'pause' })
    expect(paused.status).toBe('paused')
    expect(run(paused, tick)).toBe(paused)
    expect(run(paused, { type: 'resume' }).status).toBe('running')
    const restarted = run(lake({ status: 'over', score: 7 }), { type: 'restart', random: 0 })
    expect(restarted).toMatchObject({ status: 'running', score: 0, cols: 6, rows: 4 })
  })

  it('speeds up every five fish down to a floor, slower with reduced motion', () => {
    expect(stepMs(0, false)).toBe(160)
    expect(stepMs(5, false)).toBe(150)
    expect(stepMs(500, false)).toBe(90)
    expect(stepMs(0, true)).toBeGreaterThan(stepMs(0, false))
  })
})
