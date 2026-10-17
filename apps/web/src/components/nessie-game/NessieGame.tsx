import { Box, Center, Group, Overlay, Paper, SimpleGrid, Stack, Text, VisuallyHidden } from '@mantine/core'
import { useInterval, useLocalStorage, useReducedMotion } from '@mantine/hooks'
import { IconArrowDown, IconArrowLeft, IconArrowRight, IconArrowUp, IconPlayerPause, IconPlayerPlay, IconRefresh } from '@tabler/icons-react'
import { useId, useReducer, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ActionButton'
import ActionIcon from '../ActionIconButton'
import { gameReducer, initialGame, stepMs, type Direction } from './game'
import NessieBoard from './NessieBoard'

export const BEST_SCORE_KEY = 'onko.nessieGame.best'

const keys: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right',
}
const pad: { direction: Direction; icon: typeof IconArrowUp; column: number }[] = [
  { direction: 'up', icon: IconArrowUp, column: 2 }, { direction: 'left', icon: IconArrowLeft, column: 1 },
  { direction: 'down', icon: IconArrowDown, column: 2 }, { direction: 'right', icon: IconArrowRight, column: 3 },
]

/** Snake with Nessie: the loop runs only while playing, and pauses when focus leaves the game or the tab is hidden. */
export default function NessieGame() {
  const { t } = useTranslation()
  const reducedMotion = useReducedMotion()
  const [game, dispatch] = useReducer(gameReducer, undefined, () => initialGame(Math.random()))
  const [best, setBest] = useLocalStorage({ key: BEST_SCORE_KEY, defaultValue: 0, getInitialValueInEffect: false })
  const [previousBest, setPreviousBest] = useState(best)
  const controlsId = useId()
  // The callback sees the last rendered state, so it saves a new best and stops one step after the game ends.
  const loop = useInterval(step, stepMs(game.score, reducedMotion))
  function step() {
    if (game.score > best) setBest(game.score)
    if (game.status !== 'running') { loop.stop(); return }
    if (document.visibilityState === 'hidden') { dispatch({ type: 'pause' }); loop.stop(); return }
    dispatch({ type: 'tick', random: Math.random() })
  }

  const play = () => { setPreviousBest(Math.max(best, game.score)); loop.start() }
  const pause = () => {
    if (game.score > best) setBest(game.score)
    dispatch({ type: 'pause' })
    loop.stop()
  }
  const primary = () => {
    if (game.status === 'running') return pause()
    if (game.status === 'paused') { dispatch({ type: 'resume' }); loop.start(); return }
    dispatch(game.status === 'over' ? { type: 'restart', random: Math.random() } : { type: 'start' })
    play()
  }
  const steer = (direction: Direction) => {
    if (game.status === 'over') return
    if (game.status === 'paused') { dispatch({ type: 'resume' }); loop.start() }
    dispatch({ type: 'turn', direction })
    if (game.status === 'ready') { dispatch({ type: 'start' }); play() }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const direction = keys[event.key.length === 1 ? event.key.toLowerCase() : event.key]
    if (direction) { event.preventDefault(); steer(direction); return }
    // On the board itself Space and Enter control the game; on buttons they keep their normal meaning.
    if (event.target !== event.currentTarget.querySelector('[data-board]')) return
    if (event.key === ' ' && game.status !== 'over') { event.preventDefault(); primary() }
    if (event.key === 'Enter' && game.status !== 'running') { event.preventDefault(); primary() }
  }
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (game.status === 'running' && !event.currentTarget.contains(event.relatedTarget)) pause()
  }

  const shownBest = Math.max(best, game.score)
  const newBest = game.status === 'over' && game.score > 0 && game.score > previousBest
  const overlay = game.status === 'ready' ? t('nessieGame.ready') : game.status === 'paused' ? t('nessieGame.paused')
    : game.status === 'over' ? `${t('nessieGame.over', { score: game.score })}${newBest ? ` ${t('nessieGame.newBest')}` : ''}` : null
  const announcement = game.status === 'over' ? overlay : game.score > 0 ? t('nessieGame.caught', { count: game.score }) : ''
  const [label, Icon] = game.status === 'running' ? [t('nessieGame.pause'), IconPlayerPause]
    : game.status === 'paused' ? [t('nessieGame.resume'), IconPlayerPlay]
      : game.status === 'over' ? [t('nessieGame.restart'), IconRefresh] : [t('nessieGame.start'), IconPlayerPlay]

  return <Stack gap="sm" onKeyDown={onKeyDown} onBlur={onBlur}>
    <Text size="sm">{t('nessieGame.intro')}</Text>
    <Group justify="space-between" gap="xs">
      <Group gap="md">
        <Text size="sm"><Text span fw={600}>{t('nessieGame.score')}:</Text> {game.score}</Text>
        <Text size="sm"><Text span fw={600}>{t('nessieGame.best')}:</Text> {shownBest}</Text>
      </Group>
      <Button size="xs" variant={game.status === 'running' ? 'default' : 'filled'} leftSection={<Icon size={16} aria-hidden />} onClick={primary}>{label}</Button>
    </Group>
    <Paper withBorder radius="md" pos="relative" w="100%" maw={520} mx="auto" style={{ overflow: 'hidden' }}>
      <Box data-board data-autofocus tabIndex={0} aria-label={t('nessieGame.area')} aria-describedby={controlsId} role="group"
        onClick={(event) => event.currentTarget.focus()}>
        <NessieBoard game={game} />
      </Box>
      {overlay && <Overlay color="#fff" backgroundOpacity={0.7} zIndex={1} style={{ pointerEvents: 'none' }}>
        <Center h="100%" p="sm"><Text fw={650} ta="center" c="var(--mantine-color-text)">{overlay}</Text></Center>
      </Overlay>}
    </Paper>
    <VisuallyHidden role="status">{announcement}</VisuallyHidden>
    <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap">
      <Text id={controlsId} size="xs" c="dimmed" maw={320}>{t('nessieGame.controls')}</Text>
      <SimpleGrid cols={3} spacing={4} verticalSpacing={4} role="group" aria-label={t('nessieGame.direction')}>
        {pad.map(({ direction, icon: Arrow, column }) => <ActionIcon key={direction} size="lg" variant="light" style={{ gridColumn: column, gridRow: direction === 'up' ? 1 : 2 }}
          aria-label={t(`nessieGame.swim.${direction}`)} disabled={game.status === 'over'} onClick={() => steer(direction)}>
          <Arrow size={18} aria-hidden />
        </ActionIcon>)}
      </SimpleGrid>
    </Group>
  </Stack>
}
