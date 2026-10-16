import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// A pg Pool emits 'error' when an idle client loses its connection. attachPoolErrorHandler() must keep that from
// becoming an uncaughtException, log one redacted line and rate-limit the log. The real-Postgres counterpart is
// dbPoolErrors.pg.test.ts (skipped unless MR_PG_TEST_URL is set).

const { fakes } = vi.hoisted(() => ({ fakes: [] as unknown[] }))
vi.mock('pg', async () => {
  const { EventEmitter: EE } = await import('node:events')
  return { Pool: class extends EE { constructor() { super(); fakes.push(this) } } }
})

import { attachPoolErrorHandler, pool } from '../db.js'

let logged: string[]
beforeEach(() => {
  vi.useFakeTimers()
  logged = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')) })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

function pgError(message: string, code = '57P01'): Error {
  return Object.assign(new Error(message), { code })
}

describe('pool error listener', () => {
  it('db.ts attaches an error listener to the pool it exports', () => {
    expect((pool as unknown as EventEmitter).listenerCount('error')).toBe(1)
    expect(fakes).toContain(pool as unknown as EventEmitter)
  })

  it('an emitted error does not throw and logs one line with message and code', () => {
    const em = new EventEmitter()
    attachPoolErrorHandler(em)
    expect(() => em.emit('error', pgError('terminating connection due to administrator command'))).not.toThrow()
    expect(logged).toHaveLength(1)
    expect(logged[0]).toContain('terminating connection due to administrator command')
    expect(logged[0]).toContain('57P01')
  })

  it('redacts anything that looks like a URL with credentials', () => {
    const em = new EventEmitter()
    attachPoolErrorHandler(em)
    em.emit('error', pgError('connect failed for postgres://user:secret@host/db and then more'))
    expect(logged).toHaveLength(1)
    expect(logged[0]).not.toContain('secret')
    expect(logged[0]).not.toContain('user:')
    expect(logged[0]).not.toContain('postgres://')
    expect(logged[0]).toContain('[redacted-url]')
    expect(logged[0]).toContain('57P01')
  })

  it('tolerates non-Error values', () => {
    const em = new EventEmitter()
    attachPoolErrorHandler(em)
    expect(() => em.emit('error', undefined)).not.toThrow()
    expect(() => em.emit('error', 'boom')).not.toThrow()
  })

  it('a burst of 100 errors logs one line, then one line with the suppressed count after the interval', () => {
    const em = new EventEmitter()
    attachPoolErrorHandler(em)
    for (let i = 0; i < 100; i++) em.emit('error', pgError('terminating connection'))
    expect(logged).toHaveLength(1)
    vi.advanceTimersByTime(9_999)
    expect(logged).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(logged).toHaveLength(2)
    expect(logged[1]).toContain('99 more')
    vi.advanceTimersByTime(60_000)
    expect(logged).toHaveLength(2)
  })

  it('logs again normally once the interval has passed, and no summary line without repeats', () => {
    const em = new EventEmitter()
    attachPoolErrorHandler(em)
    em.emit('error', pgError('first'))
    vi.advanceTimersByTime(10_000)
    expect(logged).toHaveLength(1)
    em.emit('error', pgError('second'))
    expect(logged).toHaveLength(2)
    expect(logged[1]).toContain('second')
  })
})
