/** Pure rules of the Nessie waiting game: a snake on a wrap-around lake that eats fish. */

export interface Cell { x: number; y: number }
export type Direction = 'up' | 'down' | 'left' | 'right'
export type GameStatus = 'ready' | 'running' | 'paused' | 'over'

export interface GameState {
  cols: number
  rows: number
  body: Cell[]
  direction: Direction
  turns: Direction[]
  fish: Cell
  score: number
  status: GameStatus
}

export type GameAction =
  | { type: 'start' }
  | { type: 'turn'; direction: Direction }
  | { type: 'tick'; random: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'restart'; random: number }

export const BOARD = { cols: 16, rows: 12 } as const
const MAX_QUEUED_TURNS = 2

const steps: Record<Direction, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const opposite: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' }

const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y

/** Picks a free cell from `random` in [0, 1), so tests can place fish deterministically. */
export function placeFish(cols: number, rows: number, body: Cell[], random: number): Cell {
  const free: Cell[] = []
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!body.some((part) => part.x === x && part.y === y)) free.push({ x, y })
  return free[Math.min(free.length - 1, Math.floor(random * free.length))] ?? body[0]
}

export function initialGame(random: number, cols: number = BOARD.cols, rows: number = BOARD.rows): GameState {
  const y = Math.floor(rows / 2), x = Math.floor(cols / 3)
  const body = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }]
  return { cols, rows, body, direction: 'right', turns: [], fish: placeFish(cols, rows, body, random), score: 0, status: 'ready' }
}

/** Step length in ms: speeds up every five fish, down to a floor; reduced motion plays slower. */
export function stepMs(score: number, reducedMotion: boolean): number {
  const base = reducedMotion ? 260 : 160, floor = reducedMotion ? 180 : 90
  return Math.max(floor, base - Math.floor(score / 5) * 10)
}

function turn(state: GameState, direction: Direction): GameState {
  const last = state.turns.at(-1) ?? state.direction
  if (direction === last || direction === opposite[last] || state.turns.length >= MAX_QUEUED_TURNS) return state
  return { ...state, turns: [...state.turns, direction] }
}

function tick(state: GameState, random: number): GameState {
  const [direction = state.direction, ...turns] = state.turns
  const step = steps[direction]
  const head = { x: (state.body[0].x + step.x + state.cols) % state.cols, y: (state.body[0].y + step.y + state.rows) % state.rows }
  const eats = same(head, state.fish)
  // The tail moves away this step unless Nessie grows, so swimming into it is safe.
  const rest = eats ? state.body : state.body.slice(0, -1)
  if (rest.some((part) => same(part, head))) return { ...state, direction, turns, status: 'over' }
  const body = [head, ...rest]
  if (!eats) return { ...state, body, direction, turns }
  return { ...state, body, direction, turns, score: state.score + 1, fish: placeFish(state.cols, state.rows, body, random) }
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'start': return state.status === 'ready' ? { ...state, status: 'running' } : state
    case 'turn': return state.status === 'running' || state.status === 'ready' ? turn(state, action.direction) : state
    case 'tick': return state.status === 'running' ? tick(state, action.random) : state
    case 'pause': return state.status === 'running' ? { ...state, status: 'paused' } : state
    case 'resume': return state.status === 'paused' ? { ...state, status: 'running' } : state
    case 'restart': return { ...initialGame(action.random, state.cols, state.rows), status: 'running' }
  }
}
