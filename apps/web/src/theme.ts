import { createTheme } from '@mantine/core'

export const theme = createTheme({
  primaryColor: 'blue',
  primaryShade: 9,
  // Mantine's default dimmed gray is too light for small clinical text (A11Y-3).
  colors: {
    gray: ['#f8f9fa', '#f1f3f5', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#5f6871', '#495057', '#343a40', '#212529'],
  },
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  defaultRadius: 'md',
  headings: { fontWeight: '650' },
  respectReducedMotion: true,
})
