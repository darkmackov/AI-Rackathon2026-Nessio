import { Alert, Button, MantineProvider, Stack, Text } from '@mantine/core'
import '@mantine/core/styles.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import App from './App'
import { configureClient, createQueryClient } from './api'
import { initializeApi } from './initialize-api'
import { i18n } from './i18n'
import SessionProvider from './SessionProvider'
import { theme } from './theme'
import './index.css'

configureClient()
const root = createRoot(document.getElementById('root')!)

async function start() {
  await initializeApi()
  root.render(<StrictMode><MantineProvider theme={theme} forceColorScheme="light">
    <I18nextProvider i18n={i18n}><QueryClientProvider client={createQueryClient()}>
      <SessionProvider><App /></SessionProvider>
    </QueryClientProvider></I18nextProvider>
  </MantineProvider></StrictMode>)
}

void start().catch(() => {
  root.render(<MantineProvider theme={theme} forceColorScheme="light"><Alert color="red" role="alert" m="lg">
    <Stack><Text>{i18n.t('errorNetwork')}</Text><Button onClick={() => window.location.reload()}>{i18n.t('retry')}</Button></Stack>
  </Alert></MantineProvider>)
})
