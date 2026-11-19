import { describe, it, expect } from 'vitest'
import { buildHistoryEvents, compareSentence, outageFigureNote, outageHeadline, versionText } from '@/utils/historyTimeline'
import type { OutagesResponse } from '@/utils/mintDetailFacts'

const H = 3_600_000

describe('compareSentence', () => {
  it('says faster / slower for latency and higher / lower for uptime, against the named period', () => {
    expect(compareSentence('latency', 270, 305, '7d')).toBe('35 ms faster than the 7 days before')
    expect(compareSentence('latency', 310, 300, '24h')).toBe('10 ms slower than the 24 hours before')
    expect(compareSentence('uptime', 99.5, 99.9, '30d')).toBe('0.4% lower than the 30 days before')
    expect(compareSentence('uptime', 100, 98, '90d')).toBe('2% higher than the 90 days before')
  })
  it('says "Same as" for no change and nothing without data', () => {
    expect(compareSentence('latency', 270, 270.4, '7d')).toBe('Same as the 7 days before')
    expect(compareSentence('uptime', 100, 100, '7d')).toBe('Same as the 7 days before')
    expect(compareSentence('latency', null, 300, '7d')).toBeNull()
    expect(compareSentence('latency', 270, null, '7d')).toBeNull()
    expect(compareSentence('latency', 270, null, '7d', true)).toBe('Not enough history to compare yet')
  })
})

describe('buildHistoryEvents', () => {
  const versions = [
    { version: 'cdk-mintd/0.18.3', firstSeenAt: '2026-11-07T10:00:00Z' },
    { version: 'cdk-mintd/0.17.2', firstSeenAt: '2026-08-11T10:00:00Z' },
    { version: 'Nutshell/0.20.3', firstSeenAt: '2026-07-31T10:00:00Z' },
  ]
  it('merges outages and software changes, newest first; a family change is a switch', () => {
    const ev = buildHistoryEvents([{ startedAt: '2026-11-07T12:00:00Z', durationMs: 600_000 }], versions, 'timeout')
    expect(ev.map(e => e.kind)).toEqual(['outage', 'software', 'software', 'software'])
    const [, update, switched, first] = ev
    expect(update).toMatchObject({ from: 'cdk-mintd/0.17.2', to: 'cdk-mintd/0.18.3', switched: false })
    expect(switched).toMatchObject({ from: 'Nutshell/0.20.3', to: 'cdk-mintd/0.17.2', switched: true })
    expect(first).toMatchObject({ from: null, switched: false })
  })
  it('names the error on the ongoing outage only and reads the duration', () => {
    const ev = buildHistoryEvents([
      { startedAt: '2026-11-01T00:00:00Z', durationMs: 3_600_000 },
      { startedAt: '2026-11-18T00:00:00Z', durationMs: 7_500_000, ongoing: true },
    ], [], 'HTTP 502')
    expect(ev[0]).toMatchObject({ kind: 'outage', ongoing: true, error: 'HTTP 502' })
    expect(ev[1]).toMatchObject({ kind: 'outage', ongoing: false, error: null })
    expect(outageHeadline(ev[0] as Extract<typeof ev[0], { kind: 'outage' }>)).toBe('Not answering for 2h 5m so far')
    expect(outageHeadline(ev[1] as Extract<typeof ev[1], { kind: 'outage' }>)).toBe('Not answering for 1h')
  })
  it('writes a version the way a reader does', () => {
    expect(versionText('Nutshell/0.20.3')).toBe('Nutshell 0.20.3')
  })
})

describe('outageFigureNote', () => {
  const ongoing: OutagesResponse = {
    sinceLastOutageMs: null, avgRecoveryMs: 0.5 * H, outageCount: 7, recoveredCount: 6, ongoing: true,
    currentOutage: { startedAt: '2026-10-23T19:20:04.895Z', durationMs: 43 * H }, outages: [],
  }
  it('an ongoing outage reads "Down for … now", never a time since the last outage (the "2m" bug)', () => {
    expect(outageFigureNote(ongoing)).toBe('Down for 1d 19h now')
    expect(outageFigureNote({ ...ongoing, sinceLastOutageMs: 2 * 60000 })).not.toContain('ago')
  })
  it('a recovered mint: the mean time to recover and how long ago the last outage was', () => {
    expect(outageFigureNote({ sinceLastOutageMs: 2 * H, avgRecoveryMs: H, outageCount: 2, recoveredCount: 2, ongoing: false, currentOutage: null, outages: [] }))
      .toBe('1h to recover on average, the last 2h ago')
  })
  it('names the longest outage when there is more than one (methodology 7), never for one or an API without the field', () => {
    const base: OutagesResponse = { sinceLastOutageMs: 10 * 24 * H, avgRecoveryMs: 21 * H, outageCount: 8, recoveredCount: 8, ongoing: false, currentOutage: null, outages: [] }
    expect(outageFigureNote({ ...base, longestOutageMs: 162.5 * H })).toBe('21h to recover on average (longest 6d 18h), the last 10d ago')
    expect(outageFigureNote({ ...base, outageCount: 1, longestOutageMs: 3 * H })).not.toContain('longest')
    expect(outageFigureNote(base)).not.toContain('longest')
  })
  it('nothing without outages or data', () => {
    expect(outageFigureNote(undefined)).toBeNull()
    expect(outageFigureNote({ sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] })).toBeNull()
  })
})
