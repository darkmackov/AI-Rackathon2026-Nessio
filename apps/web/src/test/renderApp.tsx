import { MantineProvider } from '@mantine/core'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { createAppRouter } from '../router'
import { createQueryClient } from '../api'
import { i18n } from '../i18n'
import SessionProvider from '../SessionProvider'
import { storeActorId } from '../session'
import { theme } from '../theme'
import AppNotifications from '../notifications/AppNotifications'

/** Renders the app at `path`; `as` starts it signed in as that person, as after a reload of the tab (Q-W8). */
export function renderApp(path = '/', options: { notifications?: boolean; as?: string } = {}) {
  if (options.as) storeActorId(options.as)
  const queryClient = createQueryClient()
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  const view = render(<MantineProvider theme={theme} forceColorScheme="light" env="test">
    <I18nextProvider i18n={i18n}><QueryClientProvider client={queryClient}>
      <SessionProvider><RouterProvider router={router} /></SessionProvider>
      {options.notifications && <AppNotifications />}
    </QueryClientProvider></I18nextProvider>
  </MantineProvider>)
  return { ...view, queryClient, router }
}
