import { createRootRoute, createRoute, createRouter, type RouterHistory } from '@tanstack/react-router'
import AppShell from './components/AppShell'
import { Entry, CoordinatorRoute, ReferrerRoute, NotFound } from './RoutePages'

export function createAppRouter(history?: RouterHistory) {
  const root = createRootRoute({ component: AppShell, notFoundComponent: NotFound })
  const entry = createRoute({ getParentRoute: () => root, path: '/', component: Entry })
  const coordinator = createRoute({ getParentRoute: () => root, path: '/coordinator', component: CoordinatorRoute })
  const referrer = createRoute({ getParentRoute: () => root, path: '/referrer', component: ReferrerRoute })
  return createRouter({ routeTree: root.addChildren([entry, coordinator, referrer]), history, defaultPreload: false })
}

declare module '@tanstack/react-router' {
  interface Register { router: ReturnType<typeof createAppRouter> }
}

