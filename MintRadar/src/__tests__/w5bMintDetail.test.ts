import { describe, it, expect } from 'vitest'
import { limitedDataReasons, limitedDataText } from '@/utils/limitedData'
import { auditSourceLine, infoSourceLine, sourceLineText, uptimeSourceLine } from '@/utils/scoreSources'
import { LAST_ERROR_MAX_CHARS, sanitizeLastError, unavailableHeadline, restoreSentence, contactSentence } from '@/utils/unavailableMint'
import { PROBE_LOCATION } from '@/constants/probeLocation'

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const H = 3_600_000
const D = 24 * H
const iso = (ms: number) => new Date(ms).toISOString()

describe('limitedDataReasons', () => {
  const enough = { auditBlamed: 0, auditTotal: 40, auditFetchedAt: iso(NOW - H), discoveredAt: iso(NOW - 90 * D), now: NOW }
  it('is empty for a mint with enough data', () => {
    expect(limitedDataReasons(enough)).toEqual([])
  })
  it('names fewer than 10 swaps', () => {
    expect(limitedDataReasons({ ...enough, auditTotal: 3 })).toEqual(['audit based on fewer than 10 swaps'])
  })
  it('names stale and missing audit data', () => {
    expect(limitedDataReasons({ ...enough, auditFetchedAt: iso(NOW - 9 * D) })).toEqual(['audit data older than 7 days'])
    expect(limitedDataReasons({ ...enough, auditTotal: null })).toEqual(['no recent audit data'])
  })
  it('names the new-mint cap with the real day count', () => {
    expect(limitedDataReasons({ ...enough, discoveredAt: iso(NOW - 12.5 * D) })).toEqual(['tracked for 12 of 30 days, score capped at 75'])
    expect(limitedDataReasons({ ...enough, discoveredAt: iso(NOW - 30 * D) })).toEqual([])
  })
  it('lists both reasons and joins them into one sentence', () => {
    const r = limitedDataReasons({ ...enough, auditTotal: 2, discoveredAt: iso(NOW - 5 * D) })
    expect(r).toHaveLength(2)
    expect(limitedDataText(r)).toBe('Audit based on fewer than 10 swaps; tracked for 5 of 30 days, score capped at 75.')
  })
})

describe('score row source lines', () => {
  it('uptime: our probes from the probe location, 24 h, checks, last probe', () => {
    const l = uptimeSourceLine({ checks: 288, lastProbeAt: iso(NOW - 3 * 60_000), now: NOW })
    expect(sourceLineText(l)).toBe(`our probes from ${PROBE_LOCATION} · 24 h · 288 checks · last probe 3 min ago`)
    expect(l.time?.title).toBe('20 Oct 2026, 11:57 UTC')
  })
  it('uptime: leaves out a sample that is not known', () => {
    expect(sourceLineText(uptimeSourceLine({ checks: null, lastProbeAt: null, now: NOW }))).toBe(`our probes from ${PROBE_LOCATION} · 24 h`)
  })
  it('audit: cashu.info, 7 days, swaps, sync time', () => {
    const t = auditSourceLine({ blamed: 0, total: 14, fetchedAt: iso(NOW - 2 * H), now: NOW })
    expect(sourceLineText(t)).toBe('cashu.info · 7 days · 14 swaps · synced 2h ago')
  })
  it('audit: a neutral row says why instead of the swaps line', () => {
    expect(sourceLineText(auditSourceLine({ blamed: 0, total: 3, fetchedAt: iso(NOW - H), now: NOW }))).toBe('cashu.info · 7 days · 3 swaps, fewer than 10 (neutral) · synced 1h ago')
    expect(sourceLineText(auditSourceLine({ blamed: 0, total: 30, fetchedAt: iso(NOW - 9 * D), now: NOW }))).toContain('detail older than 7 days (neutral)')
    expect(sourceLineText(auditSourceLine({ blamed: null, total: null, fetchedAt: null, now: NOW }))).toBe('cashu.info · 7 days · no data (neutral)')
  })
  it('NUTs, version, contact: declared by the mint, with the fetch time; version adds the comparison', () => {
    expect(sourceLineText(infoSourceLine({ fetchedAt: iso(NOW - 5 * 60_000), now: NOW }))).toBe('declared by the mint in /v1/info · fetched 5 min ago')
    expect(sourceLineText(infoSourceLine({ fetchedAt: iso(NOW - 5 * 60_000), now: NOW, comparedWithLatest: true }))).toBe('declared by the mint in /v1/info · compared with the newest stable release · fetched 5 min ago')
  })
})

describe('unavailable mint', () => {
  it('uses "Unavailable since" with the day count after 24 h', () => {
    expect(unavailableHeadline({ since: iso(NOW - 8 * D), archived: false, now: NOW }).text).toBe('Unavailable since 12 Oct 2026 (8 days)')
    expect(unavailableHeadline({ since: iso(NOW - 40 * D), archived: true, now: NOW }).text).toContain('Unavailable since')
  })
  it('uses "Not responding since" under 24 h and never says archived', () => {
    const h = unavailableHeadline({ since: iso(NOW - 5 * H), archived: false, now: NOW })
    expect(h.text).toBe('Not responding since 20 Oct 2026')
    expect(h.notResponding).toBe(true)
    expect(h.text).not.toMatch(/archiv/i)
  })
  it('has a sentence for a mint never seen online', () => {
    expect(unavailableHeadline({ since: null, archived: false, now: NOW }).text).toMatch(/not seen this mint online/)
  })
  it('strips URLs and control characters from the error and caps its length', () => {
    expect(sanitizeLastError('connect failed https://evil.example/x?a=1 and wss://r.example\u0000 bad')).toBe('connect failed and bad')
    const long = sanitizeLastError('x'.repeat(5000))!
    expect(long.length).toBe(LAST_ERROR_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
    expect(sanitizeLastError('https://only.a.url')).toBeNull()
    expect(sanitizeLastError(null)).toBeNull()
  })
  it('states whether NUT-09 was listed, without verdict words', () => {
    expect(restoreSentence(true)).toContain('listed NUT-09')
    expect(restoreSentence(false)).toContain('did not list NUT-09')
    const all = [restoreSentence(true), restoreSentence(false), contactSentence([]), contactSentence(['email a@b.c'])].join(' ')
    expect(all).not.toMatch(/\b(safe|recommended|dead|scam|trusted|guaranteed)\b/i)
  })
})
