import { useQuery } from '@tanstack/react-query'
import { getDemoClockOptions } from './client/@tanstack/react-query.gen'

export function useDemoClock() {
  return useQuery({ ...getDemoClockOptions(), refetchInterval: 1000 })
}
