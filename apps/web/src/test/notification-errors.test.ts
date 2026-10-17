import { describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import { normalizeError } from '../notifications/normalize-error'

describe('safe notification errors', () => {
    it.each(['stale', 'not one of the suggested codes', 'C20 is not one of the suggested codes', 'C20.1 is not one of the suggested codes'])(
        'recognizes rejected code proposals for the popup: %s', (detail) => {
            expect(normalizeError(new ApiError(400, { detail }))).toMatchObject({ code: 'staleCodes', severity: 'warning' })
        },
    )

    it.each(['dependency cycle', 'the dependencies form a cycle', "the steps' dependencies form a cycle"])(
        'recognizes the real and demo dependency error: %s', (detail) => {
            expect(normalizeError(new ApiError(400, { detail }))).toMatchObject({ code: 'cycle', severity: 'warning' })
        },
    )

    it('keeps every backend field path without exposing rejected input', () => {
        const error = new ApiError(422, {
            detail: [
                { loc: ['body', 'title'], type: 'missing', msg: 'Field required', input: 'private text' },
                { loc: ['body', 'members', 1, 'specialty'], type: 'string_type', msg: 'private diagnosis' },
            ]
        })
        expect(normalizeError(error).fields).toEqual([
            { path: 'title', messageKey: 'notices.requiredField' },
            { path: 'members.1.specialty', messageKey: 'notices.invalidField' },
        ])
        expect(JSON.stringify(normalizeError(error))).not.toContain('private')
    })

    it('distinguishes missing conclusion text, processing and late documents', () => {
        expect(normalizeError(new ApiError(409, { detail: 'the conclusion has no text' })).code).toBe('conclusionText')
        expect(normalizeError(new ApiError(409, { detail: 'documents still processing: job-1' })).code).toBe('processing')
        expect(normalizeError(new ApiError(409, { detail: 'the handover uses documents received after 2026-10-21: doc-1' })).code).toBe('lateDocuments')
    })

    it('does not render arbitrary server details or parser exceptions', () => {
        expect(normalizeError(new ApiError(500, { detail: 'password=secret SQL stack trace' })).code).toBe('server')
        expect(normalizeError(new ApiError(422, { detail: 'cannot read the file: secret path' })).code).toBe('fileUnreadable')
        expect(normalizeError(new ApiError(200, '<html>secret</html>')).code).toBe('unexpected')
    })

    it('distinguishes a network failure, unavailable server and timeout', () => {
        expect(normalizeError(new ApiError(undefined, new TypeError('fetch failed'))).code).toBe('network')
        expect(normalizeError(new ApiError(503, 'proxy')).code).toBe('unavailable')
        expect(normalizeError(new ApiError(504, 'proxy')).code).toBe('timeout')
    })
})