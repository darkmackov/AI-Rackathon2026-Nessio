import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { Cell, Direction, GameState } from './game'

const CELL = 10
const center = (cell: Cell) => ({ x: cell.x * CELL + CELL / 2, y: cell.y * CELL + CELL / 2 })

// The favicon faces left; these turn the head toward where Nessie swims.
const facing: Record<Direction, string> = { left: '', right: 'scale(-1 1)', up: 'rotate(90)', down: 'rotate(-90) scale(1 -1)' }

/** Nessie's head, cut out of the brand mark in public/favicon.svg with a rounded clip. */
function Head({ cell, direction, clip }: { cell: Cell; direction: Direction; clip: string }) {
  const { x, y } = center(cell), width = CELL * 1.6, height = width * 44 / 58
  return <g transform={`translate(${x} ${y}) ${facing[direction]}`}>
    <svg x={-width / 2} y={-height / 2} width={width} height={height} viewBox="2 4 58 44">
      <clipPath id={clip}><ellipse cx="31" cy="26" rx="29" ry="20" /></clipPath>
      <g clipPath={`url(#${clip})`}>
        <path fill="#B7C98B" stroke="#387456" strokeWidth={2} d="M23 42C9 42 3 37 6 28 10 14 22 7 34 8c16 0 25 11 24 25-1 14-12 27-10 42 2 14 12 21 21 26 6 4 12 12 11 21-1 12-14 17-28 13-19-6-27-19-27-38 0-14 4-29 2-41l-4-14Z" />
        <path fill="#F4F7F2" d="M6 33c7 3 17 1 23 5 9 5 6 17 7 32 0 23 9 41 28 54 4 3 8 6 13 7-7 6-18 7-29 2-15-7-22-19-23-36 0-14 4-29 2-41l-4-14C14 42 8 39 6 33Z" />
        <ellipse cx="37" cy="29" rx="4" ry="4.8" fill="#23342B" />
        <ellipse cx="12" cy="31" rx="1.3" ry="1.7" fill="#769857" />
      </g>
    </svg>
  </g>
}

function Fish({ cell }: { cell: Cell }) {
  const { x, y } = center(cell)
  return <g transform={`translate(${x} ${y})`} stroke="#7A3E00" strokeWidth={0.5} strokeLinejoin="round">
    <path fill="#F08C00" d="M-4.6 0 -1.6-1.8C1-3.4 3.8-2.4 4.6 0 3.8 2.4 1 3.4-1.6 1.8Z" />
    <path fill="#F08C00" d="M-1.6-1.8-4.6-3.6-4.6 3.6-1.6 1.8" />
    <circle cx="2.4" cy="-0.5" r="0.6" fill="#23342B" stroke="none" />
  </g>
}

export default function NessieBoard({ game }: { game: GameState }) {
  const { t } = useTranslation()
  const grid = `nessie-lake-${useId().replace(/[^\w-]/g, '')}`
  const [head, ...body] = game.body
  const width = game.cols * CELL, height = game.rows * CELL
  return <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" style={{ display: 'block', borderRadius: 'var(--mantine-radius-md)' }}
    aria-label={t('nessieGame.board', { score: game.score, length: game.body.length })}>
    <defs>
      <pattern id={grid} width={CELL} height={CELL} patternUnits="userSpaceOnUse">
        <path d={`M ${CELL} 0 L 0 0 0 ${CELL}`} fill="none" stroke="#C5E3F6" strokeWidth={0.4} />
      </pattern>
    </defs>
    <rect width={width} height={height} fill="#E7F5FF" />
    <rect width={width} height={height} fill={`url(#${grid})`} />
    <Fish cell={game.fish} />
    {body.map((part, index) => {
      const { x, y } = center(part)
      const tail = index === body.length - 1
      return <circle key={`${part.x}-${part.y}`} cx={x} cy={y} r={tail ? CELL * 0.34 : CELL * 0.48}
        fill={index % 2 ? '#A4BE78' : '#B7C98B'} stroke="#387456" strokeWidth={0.6} />
    }).reverse()}
    <Head cell={head} direction={game.direction} clip={`${grid}-head`} />
  </svg>
}
