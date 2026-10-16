import { beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeApi } from '../initialize-api'

const worker = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('../mocks/browser', () => ({ worker }))
beforeEach(() => worker.start.mockReset())

describe('API mode initialization', () => {
  it('does not activate dummy interception in real API mode', async () => {
    await initializeApi('real')
    expect(worker.start).not.toHaveBeenCalled()
  })

  it('waits for interception before allowing the app to start', async () => {
    let finish: (() => void) | undefined
    worker.start.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
    let ready = false
    const initialization = initializeApi('mock').then(() => { ready = true })
    await vi.waitFor(() => expect(worker.start).toHaveBeenCalledOnce())
    expect(ready).toBe(false)
    finish?.()
    await initialization
    expect(ready).toBe(true)
  })

  it('fails visibly instead of silently changing modes when interception cannot start', async () => {
    worker.start.mockRejectedValueOnce(new Error('worker unavailable'))
    await expect(initializeApi('mock')).rejects.toThrow('worker unavailable')
  })
})
