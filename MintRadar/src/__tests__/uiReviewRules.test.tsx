// Rules from the 2026-11-10 UI review (the phone list column rule went with the 2026-11-19 redesign: phones show cards): the Compare picker lists by the shown
// score (name before the 2026-11-22 UI/UX report) with test mints last and the score in the row, and the Audit strip explains its red marks.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type { KnownMint } from '@/hooks/useKnownMints'
import { cardsLatencyNote, PROBE_LOCATION } from '@/constants/probeLocation'
import { MintComparePicker } from '@/components/MintComparePicker'

describe('probe location is said once above the cards', () => {
  it('the note names the probe location', () => {
    expect(cardsLatencyNote()).toBe(`latency from ${PROBE_LOCATION}`)
  })
})

describe('Compare picker', () => {
  const mint = (url: string, name: string, score: number | null): KnownMint => ({
    url, name, iconUrl: null, degraded: false, online: true, latencyMs: 50, version: 'Nutshell/0.16.0', nutCount: 12,
    tosUrl: null, descriptionLong: null, nutsLimits: {}, units: ['sat'], reliabilityScore: score, uptimePct24h: 100, uptimePct7d: 100,
    discoveredAt: '2025-09-01T00:00:00.000Z', lastCheckedAt: new Date().toISOString(),
  })
  // Caller order (by hostname) on purpose: the picker must not keep it.
  const CANDIDATES = [
    mint('https://8333.space:3338', 'Cashu test mint', 60),
    mint('https://antifiat.cash', 'antifiat mint', 95),
    mint('https://cashu.boats', 'Kinda Reckless Mint', 97),
    mint('https://mint.21linz.at', '21linz Cashu Mint', 80),
    mint('https://zzz.example', 'Alpha Mint', null),
  ]
  beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom */ } unobserve() { /* jsdom */ } disconnect() { /* jsdom */ } }) })
  afterEach(() => { vi.unstubAllGlobals() })

  // Since 2026-11-22 (UI/UX report M6): highest Reliability Score first, unscored after, test mints last.
  it('lists by Reliability Score (highest first), unscored after, and puts test mints last', () => {
    const { baseElement } = render(<MintComparePicker candidates={CANDIDATES} baseLabel="Base" onClose={() => undefined} onConfirm={() => undefined} />)
    const names = Array.from(baseElement.querySelectorAll('.md-picker-name')).map(n => n.textContent)
    expect(names).toEqual(['Kinda Reckless Mint', 'antifiat mint', '21linz Cashu Mint', 'Alpha Mint', 'Cashu test mint'])
  })

  it('shows the score as a plain number with a hidden label; no number for an unscored mint', () => {
    const { baseElement } = render(<MintComparePicker candidates={CANDIDATES} baseLabel="Base" onClose={() => undefined} onConfirm={() => undefined} />)
    const rows = Array.from(baseElement.querySelectorAll('.md-picker-item'))
    const score = (name: string) => rows.find(r => r.querySelector('.md-picker-name')?.textContent === name)?.querySelector('.md-picker-score')
    expect(score('antifiat mint')?.textContent).toBe('Reliability Score 95')
    expect(score('antifiat mint')?.querySelector('.sr-only')?.textContent).toBe('Reliability Score ')
    expect(score('Alpha Mint')).toBeFalsy()
    expect(baseElement.textContent).not.toContain('%')
  })
})
