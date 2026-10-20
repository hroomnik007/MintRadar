import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Every cron job swallows its error; in production the error must still leave ONE redacted line ("[cron] <job> error: ...")
// and outside production the detailed output stays. startCron() is run with node-cron and every job stubbed to fail.

const SECRET_MESSAGE = 'connect failed for postgres://user:secret@host/db after retries'

const { schedules, failing } = vi.hoisted(() => ({
  schedules: [] as Array<{ expr: string; fn: () => Promise<void> }>,
  failing: vi.fn(),
}))

vi.mock('node-cron', () => ({
  default: { schedule: (expr: string, fn: () => Promise<void>) => { schedules.push({ expr, fn }) } },
}))
vi.mock('../prober.js', () => ({
  getKnownMints: failing, probeMintToDb: vi.fn(), pruneOldHistory: failing, pruneUnvalidatedMints: failing,
  pruneAbandonedMints: failing, revalidateMints: failing, backfillServerLocations: vi.fn(), refreshServerLocations: vi.fn(),
}))
vi.mock('../discovery.js', () => ({ discoverMintsFromNostr: vi.fn(), discoverMintsFromApi: vi.fn() }))
vi.mock('../auditCz.js', () => ({ syncAuditCz: failing }))
vi.mock('../auditCzDetail.js', () => ({ syncAuditCzDetails: failing }))
vi.mock('../mintAddress.js', () => ({ refreshMintAddresses: vi.fn() }))
vi.mock('../reviewsSync.js', () => ({ refreshAllMintReviews: vi.fn(), recomputeReviewCountRollups: vi.fn(), isReviewSyncRunning: vi.fn() }))
vi.mock('../reviewsSchedule.js', () => ({ startReviewsSyncTimer: vi.fn() }))
vi.mock('../reliabilityMoversRollup.js', () => ({ refreshReliabilityMoversRollup: vi.fn() }))
vi.mock('../reviewSurgeRollup.js', () => ({ refreshReviewSurgeBaseline: failing }))
vi.mock('../db.js', async () => {
  const actual = await vi.importActual<typeof import('../db.js')>('../db.js')
  return { ...actual, pool: { query: vi.fn() }, pruneOldNotificationSubscriptions: failing }
})
vi.mock('../nostrService.js', () => ({ publishServiceProfile: vi.fn() }))
vi.mock('../versionCatalog.js', () => ({ fetchLatestUpstreamVersions: failing }))
vi.mock('../allowlist.js', () => ({ isAllowlistMode: () => false, getAllowlistUrls: () => [] }))

import { startCron } from '../cron.js'

const JOBS: Array<[string, string]> = [
  ['*/5 * * * *', 'probe'],
  ['3,13,23,33,43,53 * * * *', 'cashu.info sync'],
  ['8,38 * * * *', 'cashu.info detail'],
  ['0 3 * * *', 'prune'],
  ['15 3 * * *', 'unvalidated mint prune'],
  ['15 4 * * *', 'revalidation'],
  ['30 3 * * *', 'notification subscription prune'],
  ['45 4 * * *', 'review surge baseline'],
  ['45 3 * * *', 'version catalog update'],
]

let errors: unknown[][]
let originalEnv: string | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a) })
  failing.mockReset()
  failing.mockRejectedValue(Object.assign(new Error(SECRET_MESSAGE), { code: 'ECONNREFUSED' }))
  schedules.length = 0
  originalEnv = process.env['NODE_ENV']
  startCron()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (originalEnv === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = originalEnv
})

async function run(expr: string): Promise<void> {
  const job = schedules.find(s => s.expr === expr)
  if (!job) throw new Error(`no job scheduled for ${expr}`)
  const done = job.fn()
  await vi.advanceTimersByTimeAsync(0)
  await done
}

describe('cron job errors', () => {
  it.each(JOBS)('production: %s logs one redacted line with the job name', async (expr, name) => {
    process.env['NODE_ENV'] = 'production'
    await run(expr)
    expect(errors).toHaveLength(1)
    const line = errors[0]!.map(String).join(' ')
    expect(errors[0]).toHaveLength(1)
    expect(line.startsWith(`[cron] ${name} error: `)).toBe(true)
    expect(line).toContain('(code ECONNREFUSED)')
    expect(line).toContain('[redacted-url]')
    expect(line).not.toContain('secret')
    expect(line).not.toContain('postgres://')
    expect(line).not.toContain('\n')
  })

  it.each(JOBS)('outside production: %s keeps the detailed output (the error object)', async (expr, name) => {
    process.env['NODE_ENV'] = 'development'
    await run(expr)
    expect(errors).toHaveLength(1)
    expect(errors[0]![0]).toBe(`[cron] ${name} error:`)
    expect(errors[0]![1]).toBeInstanceOf(Error)
  })

  it('production: the message is cut to 200 characters', async () => {
    process.env['NODE_ENV'] = 'production'
    failing.mockRejectedValue(new Error('x'.repeat(500)))
    await run('0 3 * * *')
    const line = String(errors[0]![0])
    expect(line).toBe(`[cron] prune error: ${'x'.repeat(200)} (code none)`)
  })
})
