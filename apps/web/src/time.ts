// Naive contract datetimes intentionally mean computer-local time in the S0 demo (Q-W10).
export function localDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${String(value.getFullYear()).padStart(4, '0')}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
}

export function validLocalDateTime(value: string) {
  const date = new Date(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value) || !Number.isFinite(date.getTime()) || date.getFullYear() < 1) return false
  // Reject impossible dates and times skipped by a local DST transition.
  return localDateTime(date).slice(0, value.length) === value
}

export function formatDateTime(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'cs-CZ', {
    dateStyle: 'medium', timeStyle: 'medium',
  }).format(new Date(value))
}

export function formatTime(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'cs-CZ', { timeStyle: 'short' }).format(new Date(value))
}

export function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'cs-CZ', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
}
