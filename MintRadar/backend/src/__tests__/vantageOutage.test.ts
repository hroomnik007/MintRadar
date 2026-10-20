import { describe, it, expect } from 'vitest'
import {
  evaluateVantageOutage, VANTAGE_NETWORK_KINDS, VANTAGE_MIN_FAILED_PERCENT, VANTAGE_MIN_FAILED_COUNT,
  VANTAGE_MAX_CHECK_AGE_MS, VANTAGE_MIN_SEEN_UP_PERCENT, VANTAGE_MIN_COVERED,
  type VantageCashuInfo, type VantageMintResult,
} from '../vantageOutage.js'
import type { ProbeErrorKind } from '../probeErrorKind.js'

const MIN = 60_000

interface Scenario {
  /** Mints that were online before the cycle. */
  online: number
  /** Of those, failed with `kind`. */
  failed: number
  kind?: ProbeErrorKind
  /** Of the failed ones: covered by cashu.info with the given age... */
  covered: number
  /** ...of which seen up. */
  seenUp: number
  ageMs?: number
  /** Extra mints that were offline before and failed now. */
  offlineFailed?: number
}

function build(s: Scenario) {
  const results = new Map<string, VantageMintResult>()
  const info = new Map<string, VantageCashuInfo>()
  for (let i = 0; i < s.online; i++) {
    const url = `on${i}`
    const fails = i < s.failed
    results.set(url, { previousOnline: true, failureKind: fails ? (s.kind ?? 'dns') : null })
    if (fails && i < s.covered) info.set(url, { state: i < s.seenUp ? 'ok' : 'error', checkAgeMs: s.ageMs ?? 2 * MIN })
  }
  for (let i = 0; i < (s.offlineFailed ?? 0); i++) {
    const url = `off${i}`
    results.set(url, { previousOnline: false, failureKind: 'dns' })
    info.set(url, { state: 'ok', checkAgeMs: MIN })
  }
  return evaluateVantageOutage(results, info)
}

// 40 online, 30 failed (75 %), all covered and fresh, all seen up: the reference "outage" every case varies.
const base: Scenario = { online: 40, failed: 30, covered: 30, seenUp: 30 }

describe('evaluateVantageOutage', () => {
  it('constants are the ones the owner decided', () => {
    expect([VANTAGE_MIN_FAILED_PERCENT, VANTAGE_MIN_FAILED_COUNT, VANTAGE_MAX_CHECK_AGE_MS, VANTAGE_MIN_SEEN_UP_PERCENT, VANTAGE_MIN_COVERED])
      .toEqual([50, 20, 15 * MIN, 70, 10])
    expect([...VANTAGE_NETWORK_KINDS].sort()).toEqual(['dns', 'timeout', 'tls', 'unreachable'])
  })

  it('classifies the reference outage and reports the numbers', () => {
    expect(build(base)).toEqual({ classified: true, previousOnline: 40, failed: 30, covered: 30, seenUp: 30 })
  })

  it('share of the previously online mints: 49 % no, 50 % yes', () => {
    expect(build({ ...base, online: 100, failed: 49, covered: 49, seenUp: 49 }).classified).toBe(false)
    expect(build({ ...base, online: 100, failed: 50, covered: 50, seenUp: 50 }).classified).toBe(true)
  })

  it('number of failed mints: 19 no, 20 yes', () => {
    expect(build({ ...base, online: 19, failed: 19, covered: 19, seenUp: 19 }).classified).toBe(false)
    expect(build({ ...base, online: 20, failed: 20, covered: 20, seenUp: 20 }).classified).toBe(true)
  })

  it('share seen up by cashu.info: 69 % no, 70 % yes', () => {
    expect(build({ ...base, online: 100, failed: 100, covered: 100, seenUp: 69 }).classified).toBe(false)
    expect(build({ ...base, online: 100, failed: 100, covered: 100, seenUp: 70 }).classified).toBe(true)
  })

  it('covered failed mints: 9 no, 10 yes (the evidence is too thin below)', () => {
    expect(build({ ...base, covered: 9, seenUp: 9 }).classified).toBe(false)
    expect(build({ ...base, covered: 10, seenUp: 10 }).classified).toBe(true)
  })

  it('age of cashu.info last check: 14 minutes counts, 16 minutes does not', () => {
    expect(build({ ...base, ageMs: 14 * MIN }).classified).toBe(true)
    expect(build({ ...base, ageMs: 15 * MIN }).classified).toBe(true)
    expect(build({ ...base, ageMs: 16 * MIN }).classified).toBe(false)
  })

  it('stale checks are left out of the evidence, they do not count as "up"', () => {
    // 10 fresh and up + 20 stale: still enough fresh evidence.
    const results = new Map<string, VantageMintResult>()
    const info = new Map<string, VantageCashuInfo>()
    for (let i = 0; i < 30; i++) {
      results.set(`m${i}`, { previousOnline: true, failureKind: 'timeout' })
      info.set(`m${i}`, { state: 'ok', checkAgeMs: i < 10 ? MIN : 40 * MIN })
    }
    expect(evaluateVantageOutage(results, info)).toMatchObject({ classified: true, covered: 10, seenUp: 10 })
  })

  it('a clock difference of a minute is tolerated, a check far in the future is not evidence', () => {
    expect(build({ ...base, ageMs: -30_000 }).classified).toBe(true)
    expect(build({ ...base, ageMs: -10 * MIN }).classified).toBe(false)
    expect(build({ ...base, ageMs: Number.NaN }).classified).toBe(false)
  })

  it('cashu.info missing (no rows) fails open', () => {
    expect(build({ ...base, covered: 0, seenUp: 0 }).classified).toBe(false)
    expect(evaluateVantageOutage(new Map([['a', { previousOnline: true, failureKind: 'dns' }]]), new Map()).classified).toBe(false)
  })

  it('cashu.info saying "error" for the mints (they are really down) does not classify', () => {
    expect(build({ ...base, seenUp: 0 }).classified).toBe(false)
  })

  it('"warn" counts as seen up, only "error" does not', () => {
    const results = new Map<string, VantageMintResult>()
    const info = new Map<string, VantageCashuInfo>()
    for (let i = 0; i < 20; i++) {
      results.set(`m${i}`, { previousOnline: true, failureKind: 'dns' })
      info.set(`m${i}`, { state: 'warn', checkAgeMs: MIN })
    }
    expect(evaluateVantageOutage(results, info).classified).toBe(true)
  })

  for (const kind of ['dns', 'timeout', 'unreachable', 'tls'] as const) {
    it(`network failure kind "${kind}" counts`, () => {
      expect(build({ ...base, kind }).classified).toBe(true)
    })
  }

  for (const kind of ['host_error', 'blocked_by_host', 'rate_limited_by_host', 'not_cashu'] as const) {
    it(`answer of the mint "${kind}" does not count as our network failing`, () => {
      expect(build({ ...base, kind })).toMatchObject({ classified: false, failed: 0 })
    })
  }

  it('previously offline mints are ignored in the share and in the counts', () => {
    // 20 online, 10 failed (50 %) would be too few; 40 offline mints failing again must not change that.
    const r = build({ online: 20, failed: 10, covered: 10, seenUp: 10, offlineFailed: 40 })
    expect(r).toEqual({ classified: false, previousOnline: 20, failed: 10, covered: 10, seenUp: 10 })
  })

  it('mints never probed before (previousOnline null) are ignored', () => {
    const results = new Map<string, VantageMintResult>()
    for (let i = 0; i < 30; i++) results.set(`n${i}`, { previousOnline: null, failureKind: 'dns' })
    expect(evaluateVantageOutage(results, new Map()).previousOnline).toBe(0)
  })

  it('empty input is not classified', () => {
    expect(evaluateVantageOutage(new Map(), new Map()).classified).toBe(false)
  })
})
