import { describe, it, expect, vi } from 'vitest'
import {
  parseArgs, parseOnly, parseRelays, selectModules, runPublishLearn, UsageError,
  DEFAULT_DELAY_SEC, DEFAULT_RETRY_DELAY_SEC, type PublishArgs, type RunnerDeps, type PublishOutcome,
} from '../scripts/learnPublishRunner.js'
import type { ParsedModule } from '../scripts/learnModuleMarkdown.js'

// No network and no keys: the runner gets fake publish functions ("mock relays"), and the module imports no Nostr code.

const MODULES: ParsedModule[] = [1, 2, 3, 4, 5].map(order => ({ order, title: `M${order}`, summary: `S${order}`, content: `## H${order}` }))
const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

describe('parseArgs', () => {
  it('defaults to a dry run over all modules with the default pauses', () => {
    expect(parseArgs([])).toEqual({
      publish: false, print: false, only: null, relays: null,
      delaySec: DEFAULT_DELAY_SEC, retryDelaySec: DEFAULT_RETRY_DELAY_SEC, retry: true,
    })
    expect(DEFAULT_DELAY_SEC).toBeGreaterThanOrEqual(12)
    expect(DEFAULT_DELAY_SEC).toBeLessThanOrEqual(15)
    expect(DEFAULT_RETRY_DELAY_SEC).toBe(60)
  })

  it('reads every option', () => {
    expect(parseArgs(['--publish', '--print', '--only=1,3,4', '--relays=wss://relay.damus.io', '--delay=0', '--retry-delay=90', '--no-retry']))
      .toEqual({ publish: true, print: true, only: [1, 3, 4], relays: ['wss://relay.damus.io'], delaySec: 0, retryDelaySec: 90, retry: false })
  })

  it.each([
    [['--foo'], /unknown option "--foo"/],
    [['publish'], /unknown option "publish"/],
    [['--publish=yes'], /--publish takes no value/],
    [['--only'], /--only needs a value/],
    [['--only='], /--only needs a value/],
    [['--relays='], /--relays needs a value/],
    [['--delay=-1'], /whole number of seconds/],
    [['--delay=1.5'], /whole number of seconds/],
    [['--delay=601'], /at most 600/],
    [['--retry-delay=x'], /--retry-delay must be a whole number/],
    [['--only=1', '--only=2'], /given more than once/],
  ])('rejects %j', (argv, msg) => {
    expect(() => parseArgs(argv)).toThrow(UsageError)
    expect(() => parseArgs(argv)).toThrow(msg)
  })
})

describe('parseOnly', () => {
  it('keeps the given order', () => expect(parseOnly('4, 1,3')).toEqual([4, 1, 3]))
  it.each(['0', '1,,3', '1,a', '-1', '1.5', '01', '1,1', ','])('rejects "%s"', v => expect(() => parseOnly(v)).toThrow(UsageError))
})

describe('parseRelays', () => {
  it('accepts wss URLs and drops a bare trailing slash', () => {
    expect(parseRelays('wss://relay.damus.io/, wss://nos.lol,wss://example.com:444/path')).toEqual(['wss://relay.damus.io', 'wss://nos.lol', 'wss://example.com:444/path'])
  })
  it.each([
    ['ws://relay.damus.io', /must start with wss:\/\//],
    ['https://relay.damus.io', /must start with wss:\/\//],
    ['relay.damus.io', /not a valid URL/],
    ['wss://u:p@relay.damus.io', /credentials/],
    ['wss://relay.damus.io/?x=1', /query or fragment/],
    ['wss://relay.damus.io,', /comma-separated/],
    ['wss://nos.lol,wss://nos.lol/', /listed twice/],
  ])('rejects "%s"', (v, msg) => expect(() => parseRelays(v)).toThrow(msg))
})

describe('selectModules', () => {
  it('returns all modules, or the --only ones in order', () => {
    expect(selectModules(MODULES, null).map(m => m.order)).toEqual([1, 2, 3, 4, 5])
    expect(selectModules(MODULES, [4, 1]).map(m => m.order)).toEqual([4, 1])
  })
  it('names the known modules for an unknown number', () => {
    expect(() => selectModules(MODULES, [1, 9])).toThrow('--only: there is no module 9 (modules: 1, 2, 3, 4, 5)')
  })
})

type FakeEvent = { id: string }

function outcome(relays: readonly string[], failing: Record<string, string>): PublishOutcome {
  const results = relays.map(relay => (relay in failing ? { relay, ok: false, message: failing[relay] ?? '' } : { relay, ok: true, message: '' }))
  const succeeded = results.filter(r => r.ok).length
  return { succeeded, failed: results.length - succeeded, results }
}

/** A mock relay set: `firstFail` maps identifier → relay → reason for the first publish; `retryFail` the same for the retry. */
function makeDeps(firstFail: Record<string, Record<string, string>> = {}, retryFail: Record<string, Record<string, string>> = {}) {
  const lines: string[] = []
  const publishArticle = vi.fn(async (params: { identifier: string }, relays: readonly string[]) =>
    ({ ...outcome(relays, firstFail[params.identifier] ?? {}), event: { id: `ev-${params.identifier}` } }))
  const republish = vi.fn(async (relays: readonly string[], event: FakeEvent) => outcome(relays, retryFail[event.id.replace(/^ev-/, '')] ?? {}))
  const sleep = vi.fn(async () => undefined)
  const deps: RunnerDeps<FakeEvent> = { publishArticle, republish, sleep, log: l => lines.push(l), defaultRelays: DEFAULT_RELAYS }
  return { deps, lines, publishArticle, republish, sleep }
}

const args = (over: Partial<PublishArgs> = {}): PublishArgs => ({ ...parseArgs([]), ...over })

describe('runPublishLearn', () => {
  it('dry run (also with --print): publishes nothing and never waits', async () => {
    const f = makeDeps()
    const out = await runPublishLearn(args({ print: true }), MODULES, f.deps)
    expect(f.publishArticle).not.toHaveBeenCalled()
    expect(f.sleep).not.toHaveBeenCalled()
    expect(f.lines).toContain('## H3')
    expect(out.stillFailed).toEqual({})
  })

  it('waits --delay seconds between articles, not before the first', async () => {
    const f = makeDeps()
    await runPublishLearn(args({ publish: true, delaySec: 12 }), MODULES, f.deps)
    expect(f.publishArticle).toHaveBeenCalledTimes(5)
    expect(f.sleep.mock.calls).toEqual([[12_000], [12_000], [12_000], [12_000]])
    expect(f.republish).not.toHaveBeenCalled()
    expect(f.lines.at(-1)).toBe('[publish-learn] done — every article is on every relay')
  })

  it('prints each failed relay with its reason and retries only those relays once, with the same event, after --retry-delay', async () => {
    const f = makeDeps({
      'mintradar-learn-module-1': { 'wss://relay.damus.io': 'rate-limited: slow down' },
      'mintradar-learn-module-3': { 'wss://relay.damus.io': 'rate-limited: slow down', 'wss://nos.lol': 'timeout' },
    })
    const out = await runPublishLearn(args({ publish: true }), MODULES, f.deps)
    expect(f.lines).toContain('  ✗ wss://relay.damus.io — rate-limited: slow down')
    expect(f.lines).toContain('  ✗ wss://nos.lol — timeout')
    expect(f.republish.mock.calls).toEqual([
      [['wss://relay.damus.io'], { id: 'ev-mintradar-learn-module-1' }],
      [['wss://relay.damus.io', 'wss://nos.lol'], { id: 'ev-mintradar-learn-module-3' }],
    ])
    // 4 pauses between the 5 articles, then the retry delay, then one pause between the two retries
    expect(f.sleep.mock.calls.map(c => (c as unknown[])[0])).toEqual([15_000, 15_000, 15_000, 15_000, 60_000, 15_000])
    expect(out.stillFailed).toEqual({})
  })

  it('reports relays that still fail after the retry', async () => {
    const fail = { 'mintradar-learn-module-4': { 'wss://relay.damus.io': 'blocked: no' } }
    const f = makeDeps(fail, fail)
    const out = await runPublishLearn(args({ publish: true }), MODULES, f.deps)
    expect(f.republish).toHaveBeenCalledTimes(1)
    expect(out.stillFailed).toEqual({ 'mintradar-learn-module-4': ['wss://relay.damus.io'] })
    expect(f.lines).toContain('  mintradar-learn-module-4: wss://relay.damus.io')
  })

  it('--no-retry: no retry, failures are reported', async () => {
    const f = makeDeps({ 'mintradar-learn-module-2': { 'wss://nos.lol': 'timeout' } })
    const out = await runPublishLearn(args({ publish: true, retry: false }), MODULES, f.deps)
    expect(f.republish).not.toHaveBeenCalled()
    expect(out.stillFailed).toEqual({ 'mintradar-learn-module-2': ['wss://nos.lol'] })
  })

  it('--only and --relays: only those modules, only those relays (resend 1, 3, 4 to damus)', async () => {
    const f = makeDeps()
    await runPublishLearn(args({ publish: true, only: [1, 3, 4], relays: ['wss://relay.damus.io'] }), MODULES, f.deps)
    expect(f.publishArticle.mock.calls.map(c => [c[0].identifier, c[1]])).toEqual([
      ['mintradar-learn-module-1', ['wss://relay.damus.io']],
      ['mintradar-learn-module-3', ['wss://relay.damus.io']],
      ['mintradar-learn-module-4', ['wss://relay.damus.io']],
    ])
  })

  it('uses the default long-form relays without --relays', async () => {
    const f = makeDeps()
    await runPublishLearn(args({ publish: true, only: [2] }), MODULES, f.deps)
    expect(f.publishArticle.mock.calls[0]?.[1]).toEqual(DEFAULT_RELAYS)
    expect(f.sleep).not.toHaveBeenCalled()
  })

  it('an unknown --only module stops before anything is published', async () => {
    const f = makeDeps()
    await expect(runPublishLearn(args({ publish: true, only: [6] }), MODULES, f.deps)).rejects.toThrow(UsageError)
    expect(f.publishArticle).not.toHaveBeenCalled()
  })
})
