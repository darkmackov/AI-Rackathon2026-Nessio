import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { normalizeError } from './normalize-error'
import { notifyWarning } from './notify'

export function formProblems(errors: Record<string, ReactNode>, labels: Record<string, string>) {
    return Object.entries(errors).flatMap(([path, error]) => typeof error === 'string' ? [`${labels[path] ?? path}: ${error}`] : [])
}

export function notifyFormErrors(errors: Record<string, ReactNode>, labels: Record<string, string>, t: TFunction, id: string) {
    const names = Object.keys(errors).map((path) => labels[path]).filter((label): label is string => !!label)
    if (names.length) notifyWarning(`form:${id}`, t('notices.formFields', { fields: [...new Set(names)].join(', ') }))
}

export function apiFieldErrors(error: unknown, labels: Record<string, string>, t: TFunction, aliases: Record<string, string> = {}) {
    const errors: Record<string, string> = {}
    for (const field of normalizeError(error).fields) {
        const path = aliases[field.path] ?? field.path
        if (labels[path]) errors[path] = t(field.messageKey, { field: labels[path] })
    }
    return errors
}