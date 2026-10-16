import { useQuery } from '@tanstack/react-query'
import { getDemoClockOptions } from './client/@tanstack/react-query.gen'

export const demoResetMutationKey = ['demoReset']

export function useDemoClock() {
  return useQuery({ ...getDemoClockOptions(), refetchInterval: 1000 })
}
