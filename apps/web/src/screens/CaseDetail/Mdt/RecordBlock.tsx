import { Group, Paper, Stack, ThemeIcon, Title } from '@mantine/core'
import type { ReactNode } from 'react'

/** One numbered (or icon-marked) block of the MDT record or conclusion, so every block reads the same. */
export default function RecordBlock({ number, icon, title, aside, primary = false, children }: {
  number?: number; icon?: ReactNode; title: string; aside?: ReactNode; primary?: boolean; children: ReactNode;
}) {
  const marker = number != null
    ? <ThemeIcon size={26} radius="xl" variant={primary ? 'filled' : 'light'} aria-hidden>{number}</ThemeIcon>
    : icon && <ThemeIcon size={26} radius="xl" variant="light" color="gray" c="dark.6" aria-hidden>{icon}</ThemeIcon>
  return <Paper component="section" aria-label={title} withBorder p="md" h="100%"
    style={primary ? { borderLeft: '4px solid var(--mantine-primary-color-filled)' } : undefined}><Stack gap="sm">
    <Group justify="space-between" gap="sm" wrap="wrap">
      <Group gap="sm" wrap="nowrap">{marker}<Title order={3} size="h5">{title}</Title></Group>
      {aside}
    </Group>
    {children}
  </Stack></Paper>
}
