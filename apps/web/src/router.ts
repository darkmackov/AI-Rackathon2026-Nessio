import { createRootRoute, createRoute, createRouter, type RouterHistory } from '@tanstack/react-router'
import AppShell from './components/AppShell'
import { Entry, CoordinatorRoute, CoordinatorDetailRoute, ReferrerRoute, ReferralRoute, NotFound } from './RoutePages'
import { detailSearch } from './case-route'
import { entrySearch } from './session'
import RouteFailure from './components/RouteFailure'
import { i18n } from './i18n'
import { notifyError } from './notifications/notify'

export function createAppRouter(history?: RouterHistory) {
  const root = createRootRoute({
    component: AppShell, notFoundComponent: NotFound, errorComponent: RouteFailure,
    onCatch: () => notifyError('route', i18n.t('notices.pageFailed'))
  })
  const entry = createRoute({ getParentRoute: () => root, path: '/', validateSearch: entrySearch, component: Entry })
  const coordinator = createRoute({ getParentRoute: () => root, path: '/coordinator', component: CoordinatorRoute })
  const referrer = createRoute({ getParentRoute: () => root, path: '/referrer', component: ReferrerRoute })
  const referral = createRoute({ getParentRoute: () => root, path: '/referrer/cases/$caseId', component: ReferralRoute })
  const detail = createRoute({ getParentRoute: () => root, path: '/coordinator/cases/$caseId', validateSearch: detailSearch, component: CoordinatorDetailRoute })
  return createRouter({ routeTree: root.addChildren([entry, coordinator, referrer, referral, detail]), history, defaultPreload: false })
}

declare module '@tanstack/react-router' {
  interface Register { router: ReturnType<typeof createAppRouter> }
}

