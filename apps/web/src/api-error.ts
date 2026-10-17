export class ApiError extends Error {
    status: number | undefined
    detail: unknown
    operation?: string
    scope?: string

    constructor(status: number | undefined, detail: unknown, operation?: string, scope?: string) {
        super('API request failed')
        this.status = status
        this.detail = detail
        this.operation = operation
        this.scope = scope
    }
}