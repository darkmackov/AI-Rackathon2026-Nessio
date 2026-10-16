import type { Case, TimeToTreatment } from '../client/types.gen'
import { localDateTime } from '../time'

function calendarDay(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

// Simulated server logic only. The real backend will need the agreed running-interval semantics.
export function treatmentTime(item: Case, now: string): TimeToTreatment {
  const m = item.milestones
  const points = [m?.symptom_onset, m?.referred_at ? localDateTime(new Date(m.referred_at)).slice(0, 10) : null, m?.mdt_held, m?.treatment_start]
  const intervals = [0, 1, 2].map((index) => {
    const start = points[index]
    const end = points[index + 1] ?? (points.slice(index + 2).some(Boolean) ? null : now)
    if (!start || !end) return null
    const difference = calendarDay(end) - calendarDay(start)
    return Number.isFinite(difference) && difference >= 0 ? difference : null
  })
  const last = points[3] ? 2 : points[2] ? 2 : points[1] ? 1 : 0
  const counted = intervals.slice(0, last + 1)
  return { t1: intervals[0], t2: intervals[1], t3: intervals[2], total: counted.every((value) => value !== null) ? counted.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null }
}
