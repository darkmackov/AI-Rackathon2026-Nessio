import { Anchor, Stack, Text } from '@mantine/core'
import { Link, Navigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { lazy, Suspense, type ReactNode } from 'react'
import LoadingState, { QueryError } from './components/DataState'
import PageHeading from './components/PageHeading'
import CoordinatorDashboard from './screens/CoordinatorDashboard'
import IdentitySelection from './screens/IdentitySelection'
import ReferrerHome from './screens/ReferrerHome'
import { roleHome, useSession, type UserRole } from './session'

const CaseDetail = lazy(() => import('./screens/CaseDetail/CaseDetail'))
const Referral = lazy(() => import('./screens/Referral/Referral'))

export function Entry() {
  const { actor } = useSession()
  return actor ? <Navigate to={roleHome(actor.role)} replace /> : <IdentitySelection />
}

function RolePage({ role, children }: { role: UserRole; children?: ReactNode }) {
  const { actor, actorId, identity } = useSession()
  if (!actorId) return <Navigate to="/" replace />
  if (identity.isPending) return <LoadingState />
  if (identity.isError) return <QueryError error={identity.error} pending={identity.isFetching} retry={() => { void identity.refetch() }} />
  if (!actor) return null
  if (actor.role !== role) return <Navigate to={roleHome(actor.role)} replace />
  return children ?? (role === 'coordinator' ? <CoordinatorDashboard /> : <ReferrerHome />)
}

export function NotFound() {
  const { t } = useTranslation()
  const { actor } = useSession()
  return <Stack><PageHeading>{t('notFound')}</PageHeading><Text>{t('notFoundDescription')}</Text>
    <Anchor component={Link} to={actor ? roleHome(actor.role) : '/'}>{t('home')}</Anchor>
  </Stack>
}
export function CoordinatorRoute() { return <RolePage role="coordinator" /> }
export function ReferrerRoute() { return <RolePage role="referring_doctor" /> }
export function ReferralRoute() { return <RolePage role="referring_doctor"><Suspense fallback={<LoadingState />}><Referral /></Suspense></RolePage> }
export function CoordinatorDetailRoute() { return <RolePage role="coordinator"><Suspense fallback={<LoadingState />}><CaseDetail /></Suspense></RolePage> }
