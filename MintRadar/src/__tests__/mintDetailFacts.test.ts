import { describe, it, expect } from 'vitest'
import {
  outageTiles, outageErrorCell, breakdownRowScore, breakdownPointsColor, storedBreakdownTotal, contactKindsText, infoTextFor,
  readLastInfo, averageReliability, latencyPercentilesText, showTorFor, contactsNotSavedYet, storedKeysetsAsLive, CONTACTS_NOT_SAVED_TEXT,
  type OutagesResponse, type StoredScoreBreakdown, type BreakdownPart,
} from '@/utils/mintDetailFacts'
import { pickInputFee } from '@/utils/mintProbeDisplay'
import { COMPARE_UPTIME_LABEL, COMPARE_LATENCY_LABEL, CARD_LATENCY_LABEL } from '@/utils/compareLabels'

const fmt = (ms: number) => `${Math.round(ms / 60000)}m`
const H = 3_600_000

describe('outage tiles', () => {
  const ongoing: OutagesResponse = {
    sinceLastOutageMs: null, avgRecoveryMs: 0.5 * H, outageCount: 7, recoveredCount: 6, ongoing: true,
    currentOutage: { startedAt: '2026-10-23T19:20:04.895Z', durationMs: 43 * H },
    outages: [{ startedAt: '2026-10-23T19:20:04.895Z', durationMs: 43 * H, error: 'offline', ongoing: true, truncatedAtWindowStart: false }],
  }
  it('an ongoing outage reads "Down now" + its duration and never "Since last outage"', () => {
    const t = outageTiles(ongoing, 'Outages (30d)', fmt)
    expect(t[0]).toEqual({ key: 'down', label: 'Down now', value: '2580m' })
    expect(t.map(x => x.label)).not.toContain('Since last outage')
    // even when an old API still sends a small sinceLastOutageMs (the "2m" bug)
    const old = outageTiles({ ...ongoing, sinceLastOutageMs: 2 * 60000 }, 'Outages (30d)', fmt)
    expect(old.map(x => `${x.label}: ${x.value}`)).not.toContain('Since last outage: 2m')
  })
  it('time to recover is the API mean of recovered outages, labelled with their count while one is ongoing', () => {
    const t = outageTiles(ongoing, 'Outages (30d)', fmt)
    expect(t[1]).toEqual({ key: 'recover', label: 'Time to recover (6 recovered)', value: '30m' })
    expect(outageTiles({ ...ongoing, avgRecoveryMs: null, recoveredCount: 0 }, 'x', fmt)[1]!.value).toBe('—')
  })
  it('recovered mint: "Since last outage"', () => {
    const t = outageTiles({ sinceLastOutageMs: 2 * H, avgRecoveryMs: H, outageCount: 2, recoveredCount: 2, ongoing: false, currentOutage: null, outages: [] }, 'Outages (30d)', fmt)
    expect(t.map(x => x.label)).toEqual(['Since last outage', 'Time to recover', 'Outages (30d)'])
    expect(t[0]!.value).toBe('120m')
  })
  it('no data yet: dashes', () => {
    expect(outageTiles(undefined, 'c', fmt).map(x => x.value)).toEqual(['—', '—', '—'])
  })
  it('error cell: the stored last error on the ongoing row only, never a fake "offline"', () => {
    expect(outageErrorCell({ ongoing: true }, 'HTTP 502')).toBe('HTTP 502')
    expect(outageErrorCell({ ongoing: false }, 'HTTP 502')).toBe('')
    expect(outageErrorCell({}, 'HTTP 502')).toBe('')
    expect(outageErrorCell({ ongoing: true }, null)).toBe('')
  })
})

describe('score breakdown from the stored record', () => {
  // mint.lnpay.cz on 2026-10-25: offline, score 60.
  const LNPAY: StoredScoreBreakdown = {
    uptime: { points: 0, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 15, max: 15 }, version: { points: 15, max: 15 },
    contact: { points: 5, max: 5 }, newMintCap: { points: 0, cap: 75 }, sum: 60,
  }
  const parts: BreakdownPart[] = ['uptime', 'audit', 'nuts', 'version', 'contact']
  it('offline mint without live contacts, stored contact 5/5: shows 5/5, rows sum to the shown 60', () => {
    expect(breakdownRowScore(LNPAY, 'contact', 0)).toBe(5)
    const rows = parts.map(p => breakdownRowScore(LNPAY, p, 0)!)
    expect(rows.reduce((a, b) => a + b, 0)).toBe(60)
    expect(storedBreakdownTotal(LNPAY)).toBe(LNPAY.sum)
  })
  it('falls back to the live computation only without a stored breakdown', () => {
    expect(breakdownRowScore(null, 'contact', 0)).toBe(0)
    expect(breakdownRowScore(undefined, 'uptime', null)).toBeNull()
  })
  it('new-mint cap correction keeps the total equal to the stored sum', () => {
    const capped: StoredScoreBreakdown = { ...LNPAY, uptime: { points: 40, max: 40 }, newMintCap: { points: -25, cap: 75 }, sum: 75 }
    expect(storedBreakdownTotal(capped)).toBe(75)
  })
  it('colour bands by share of the maximum', () => {
    expect(breakdownPointsColor(5, 5)).toBe('var(--accent)')
    expect(breakdownPointsColor(6, 15)).toBe('var(--amber)')
    expect(breakdownPointsColor(0, 40)).toBe('var(--red)')
    expect(breakdownPointsColor(null, 40)).toBe('var(--text3)')
  })
  it('contact row text from the check kinds, never a value', () => {
    const at = '2026-10-23T04:50:02.785Z'
    expect(contactKindsText([{ kind: 'email', formatValid: true, domainResolves: true, checkedAt: at }, { kind: 'nostr', formatValid: true, domainResolves: null, checkedAt: at }])).toBe('Email + Nostr')
    expect(contactKindsText([])).toBeNull()
  })
})

describe('last known MOTD / description', () => {
  const last = { motd: 'Maintenance tonight', description: 'A test mint', seenAt: '2026-10-23T19:15:01.246Z' }
  it('live info wins and has no "last seen"', () => {
    expect(infoTextFor({ motd: 'live', description: 'd' }, last)).toEqual({ motd: 'live', description: 'd', lastSeenAt: null })
    expect(infoTextFor({}, last)).toEqual({ lastSeenAt: null })
  })
  it('without live info: the last confirmed values with their time', () => {
    expect(infoTextFor(null, last)).toEqual({ motd: 'Maintenance tonight', description: 'A test mint', lastSeenAt: last.seenAt })
    expect(infoTextFor(undefined, { motd: null, description: null, seenAt: last.seenAt })).toEqual({ lastSeenAt: null })
    expect(infoTextFor(null, undefined)).toEqual({ lastSeenAt: null })
  })
  it('reads the probe field defensively', () => {
    expect(readLastInfo(null)).toBeUndefined()
    expect(readLastInfo('x')).toBeUndefined()
    expect(readLastInfo({ motd: 5, description: '', seenAt: 'x' })).toEqual({ motd: null, description: null, seenAt: 'x' })
  })
})

describe('History summary', () => {
  it('average reliability of 7d segments [80, 90, null] is 85, not the current score', () => {
    expect(averageReliability([{ reliabilityScore: 80 }, { reliabilityScore: 90 }, { reliabilityScore: null }])).toBe(85)
  })
  it('rounds; none: null (shown as "—")', () => {
    expect(averageReliability([{ reliabilityScore: 80 }, { reliabilityScore: 81 }])).toBe(81)
    expect(averageReliability([{ reliabilityScore: null }])).toBeNull()
    expect(averageReliability(undefined)).toBeNull()
  })
  it('median / p95 line', () => {
    expect(latencyPercentilesText(120, 480.4)).toBe('Median 120 ms · p95 480 ms')
    expect(latencyPercentilesText(120, null)).toBe('Median 120 ms · p95 —')
    expect(latencyPercentilesText(null, undefined)).toBeNull()
  })
})

describe('small offline fallbacks', () => {
  it('Tor: also from the stored hasOnion', () => {
    expect(showTorFor(false, false, true)).toBe(true)
    expect(showTorFor(false, false, null)).toBe(false)
    expect(showTorFor(false, true, false)).toBe(true)
    expect(showTorFor(true, false, undefined)).toBe(true)
  })
  it('"Contacts not saved yet" only with checks and no contact value', () => {
    const c = [{ kind: 'email', formatValid: true, domainResolves: true, checkedAt: '2026-10-23T04:50:02.785Z' }]
    expect(contactsNotSavedYet(c, 0)).toBe(true)
    expect(contactsNotSavedYet(c, 1)).toBe(false)
    expect(contactsNotSavedYet([], 0)).toBe(false)
    expect(contactsNotSavedYet(undefined, 0)).toBe(false)
    expect(CONTACTS_NOT_SAVED_TEXT).toBe('Contacts not saved yet; stored from the next successful check')
  })
  it('Compare input fee from the stored keysets (lnpay: active 200 ppk)', () => {
    const lnpay = [
      { id: '004558e8362903b1', unit: 'sat', active: false, inputFeePpk: 100 },
      { id: '00534ab3e6b75ca1', unit: 'sat', active: false, inputFeePpk: 0 },
      { id: '01cbb9af', unit: 'sat', active: true, inputFeePpk: 200 },
    ]
    expect(pickInputFee(storedKeysetsAsLive(lnpay))).toEqual({ label: '200 ppk', unit: 'sat' })
    expect(storedKeysetsAsLive([{ id: 'a', unit: 'sat', active: true, inputFeePpk: null }])).toEqual([{ id: 'a', unit: 'sat', active: true }])
    expect(storedKeysetsAsLive([])).toBeNull()
    expect(storedKeysetsAsLive(undefined)).toBeNull()
  })
})

describe('honest single-sample labels', () => {
  it('Compare uptime row is the 24h figure; latency is the last check', () => {
    expect(COMPARE_UPTIME_LABEL).toBe('Uptime 24h')
    expect(COMPARE_LATENCY_LABEL).toBe('Latency (last check)')
    expect(CARD_LATENCY_LABEL).toBe('Latency (last check)')
  })
})
