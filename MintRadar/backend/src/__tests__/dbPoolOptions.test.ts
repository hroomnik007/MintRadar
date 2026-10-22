import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The pool passes the startup option `-c jit=off` to every connection (db.ts, task E2b). The Pool constructor is mocked,
// so nothing connects.

const { configs } = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>> }))
vi.mock('pg', async () => {
  const { EventEmitter: EE } = await import('node:events')
  return { Pool: class extends EE { constructor(config: Record<string, unknown>) { super(); configs.push(config) } } }
})

const savedUrl = process.env['DATABASE_URL']
const savedPgOptions = process.env['PGOPTIONS']
beforeEach(() => { configs.length = 0; vi.resetModules() })
afterEach(() => {
  if (savedUrl === undefined) delete process.env['DATABASE_URL']; else process.env['DATABASE_URL'] = savedUrl
  if (savedPgOptions === undefined) delete process.env['PGOPTIONS']; else process.env['PGOPTIONS'] = savedPgOptions
})

describe('pool configuration', () => {
  it('passes options "-c jit=off" and keeps the other settings', async () => {
    delete process.env['PGOPTIONS']
    process.env['DATABASE_URL'] = 'postgres://u:p@localhost:5432/db'
    await import('../db.js')
    expect(configs).toHaveLength(1)
    expect(configs[0]!['options']).toBe('-c jit=off')
    expect(configs[0]).toMatchObject({
      connectionString: 'postgres://u:p@localhost:5432/db',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  })

  it('merges with an options query parameter of the connection string', async () => {
    delete process.env['PGOPTIONS']
    process.env['DATABASE_URL'] = 'postgres://u:p@localhost:5432/db?options=-c%20search_path%3Dapp'
    await import('../db.js')
    expect(configs[0]!['options']).toBe('-c search_path=app -c jit=off')
  })

  it('merges with PGOPTIONS', async () => {
    process.env['PGOPTIONS'] = '-c lock_timeout=5000'
    process.env['DATABASE_URL'] = 'postgres://u:p@localhost:5432/db'
    await import('../db.js')
    expect(configs[0]!['options']).toBe('-c lock_timeout=5000 -c jit=off')
  })

  it('works without DATABASE_URL', async () => {
    delete process.env['PGOPTIONS']
    delete process.env['DATABASE_URL']
    await import('../db.js')
    expect(configs[0]!['options']).toBe('-c jit=off')
  })
})
