import type { TFunction } from 'i18next'

export function fieldLabel(path: string, t: TFunction) {
    const parts = path.split('.')
    const key = parts.at(-1) ?? ''
    const label = t(`notices.fieldNames.${key}`, { defaultValue: t('notices.unknownField') })
    const collection = parts[0] === 'members' ? 'member' : parts[0] === 'results' ? 'resultRow' : parts[0] === 'steps' ? 'step' : null
    return collection && /^\d+$/u.test(parts[1] ?? '') ? `${t(`notices.${collection}`, { number: Number(parts[1]) + 1 })}: ${label}` : label
}