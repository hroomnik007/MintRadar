import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { changeMark, dateMark, feeDates, infoDates, infoTitle, keysetDates, keysetPending, parseFeeText, NOT_CONFIRMED } from '@/utils/changeDates'
import { parseMintChanges, type MintChange, type MintChangesData } from '@/utils/mintChangeLog'
import { MintFeesLimits } from '@/components/mint/MintFeesLimits'

vi.mock('@/components/InfoTooltip', () => ({ InfoTooltip: () => null }))

// Run in UTC (vitest config TZ, or the default) — the labels below are local dates; the tests compare against dateMark itself.
const NOW = Date.parse('2026-10-25T12:00:00Z')
const TRACK = '2026-10-10T08:00:00.000Z'
const A = '0a'.repeat(8)
const B = '0b'.repeat(8)
const C = '0c'.repeat(8)
const lbl = (iso: string) => dateMark(iso, NOW).label

function ch(type: string, oldValue: string | null, newValue: string | null, firstSeenAt: string, field = 'x'): MintChange {
  return { type, field, oldValue, newValue, firstSeenAt, observedAt: new Date(Date.parse(firstSeenAt) + 3600_000).toISOString() }
}
function data(over: Partial<MintChangesData> = {}): MintChangesData {
  return { url: 'https://mint.lnpay.cz', trackingSince: TRACK, changes: [], pending: null, keysetsSeen: [], ...over }
}

afterEach(cleanup)

describe('dateMark', () => {
  it('short local date in the row, local and UTC in the title; the year only when it is not the current one', () => {
    const m = dateMark('2026-10-20T10:00:00Z', NOW)
    expect(m.label).toMatch(/^\d{1,2} Oct$/)
    expect(m.title).toMatch(/\(your time\) · 20 Oct 2026, 10:00 UTC$/)
    expect(dateMark('2025-03-01T10:00:00Z', NOW).label).toMatch(/2025$/)
  })
})

describe('keysetDates', () => {
  it('active keyset: "Active since" the confirmed keyset_added', () => {
    const d = data({ changes: [ch('keyset_added', null, `${A} (sat, active, 100 ppk)`, '2026-10-21T09:00:00Z')], keysetsSeen: [{ id: A, firstSeenAt: '2026-10-21T09:00:00Z', lastSeenAt: '2026-10-25T09:00:00Z' }] })
    expect(keysetDates(A, true, d, NOW)?.text).toBe(`Active since ${lbl('2026-10-21T09:00:00Z')}`)
  })

  it('active keyset first seen after tracking without a change row: since its first sighting', () => {
    const d = data({ keysetsSeen: [{ id: A, firstSeenAt: '2026-10-15T09:00:00Z', lastSeenAt: '2026-10-25T09:00:00Z' }] })
    expect(keysetDates(A, true, d, NOW)?.text).toBe(`Active since ${lbl('2026-10-15T09:00:00Z')}`)
  })

  it('already active when tracking started: "Active since before <tracking start>"', () => {
    const d = data({ keysetsSeen: [{ id: A, firstSeenAt: '2026-09-01T09:00:00Z', lastSeenAt: '2026-10-25T09:00:00Z' }] })
    const r = keysetDates(A, true, d, NOW)!
    expect(r.text).toBe(`Active since before ${lbl(TRACK)}`)
    expect(r.title).toMatch(/started tracking/)
  })

  it('inactive keyset: "<from> – <to>" with to = the confirmed keyset_deactivated', () => {
    const d = data({
      changes: [
        ch('keyset_deactivated', `${B} (sat, active, 0 ppk)`, `${B} (sat, inactive, 0 ppk)`, '2026-10-23T09:00:00Z'),
        ch('keyset_added', null, `${B} (sat, active, 0 ppk)`, '2026-10-20T09:00:00Z'),
      ],
    })
    expect(keysetDates(B, false, d, NOW)?.text).toBe(`${lbl('2026-10-20T09:00:00Z')} – ${lbl('2026-10-23T09:00:00Z')}`)
  })

  it('inactive keyset that was there before tracking: "before <tracking> – <to>"', () => {
    const d = data({
      changes: [ch('keyset_deactivated', `${B} (sat, active)`, `${B} (sat, inactive)`, '2026-10-23T09:00:00Z')],
      keysetsSeen: [{ id: B, firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-10-25T00:00:00Z' }],
    })
    expect(keysetDates(B, false, d, NOW)?.text).toBe(`before ${lbl(TRACK)} – ${lbl('2026-10-23T09:00:00Z')}`)
  })

  it('inactive keyset with no known deactivation: "inactive, first seen inactive <date>"', () => {
    const d = data({ keysetsSeen: [{ id: C, firstSeenAt: '2026-10-12T00:00:00Z', lastSeenAt: '2026-10-25T00:00:00Z' }] })
    expect(keysetDates(C, false, d, NOW)?.text).toBe(`inactive, first seen inactive ${lbl('2026-10-12T00:00:00Z')}`)
  })

  it('nothing known: no dates; another keyset id that shares a prefix does not match', () => {
    expect(keysetDates(A, true, null, NOW)).toBeNull()
    expect(keysetDates(C, false, data(), NOW)).toBeNull()
    const d = data({ changes: [ch('keyset_added', null, `${A}ff (sat, active)`, '2026-10-21T09:00:00Z')], trackingSince: null })
    expect(keysetDates(A, true, d, NOW)).toBeNull()
  })

  it('a keyset seen once: only the pending tag, never a confirmed date', () => {
    const d = data({ pending: { firstSeenAt: '2026-10-25T10:00:00Z', diff: [{ type: 'keyset_added', field: 'keysets', oldValue: null, newValue: `${A} (sat, active)`, firstSeenAt: '2026-10-25T10:00:00Z' }] } })
    expect(keysetDates(A, true, d, NOW)).toBeNull()
    const p = keysetPending(A, d, NOW)!
    expect(p.text).toBe(`seen 2h ago, ${NOT_CONFIRMED}`)
    expect(keysetPending(B, d, NOW)).toBeNull()
  })
})

describe('feeDates', () => {
  const changes = [
    ch('input_fee_changed', 'sat: 100 ppk, usd: 0 ppk', 'sat: 200 ppk, usd: 0 ppk', '2026-10-23T09:00:00Z', 'fees'),
    ch('input_fee_changed', 'sat: 0 ppk, usd: 0 ppk', 'sat: 100 ppk, usd: 0 ppk', '2026-10-20T09:00:00Z', 'fees'),
  ]

  it('parses the backend fee text', () => {
    expect(parseFeeText('sat: 100 ppk, usd: 0 ppk')).toEqual({ sat: 100, usd: 0 })
    expect(parseFeeText('none')).toEqual({})
    expect(parseFeeText('multiple changes')).toBeNull()
  })

  it('"since" the last confirmed change of the unit', () => {
    const f = feeDates('sat', data({ changes }), NOW)!
    expect(f.since?.label).toBe(lbl('2026-10-23T09:00:00Z'))
    expect(f.unchangedSince).toBeNull()
  })

  it('the history lists the previous values with their ranges, newest first', () => {
    const f = feeDates('sat', data({ changes }), NOW)!
    expect(f.history.map(h => h.text)).toEqual([
      `100 ppk · 0.1 sat per coin · ${lbl('2026-10-20T09:00:00Z')} – ${lbl('2026-10-23T09:00:00Z')}`,
      `No input fee · before ${lbl(TRACK)} – ${lbl('2026-10-20T09:00:00Z')}`,
    ])
  })

  it('no change of the unit: "unchanged since <tracking start>", no history', () => {
    const f = feeDates('usd', data({ changes }), NOW)!
    expect(f.since).toBeNull()
    expect(f.unchangedSince?.label).toBe(lbl(TRACK))
    expect(f.history).toEqual([])
  })

  it('a fee seen once is a pending tag, not a date', () => {
    const d = data({ pending: { firstSeenAt: '2026-10-25T11:00:00Z', diff: [{ type: 'input_fee_changed', field: 'fees', oldValue: 'sat: 0 ppk', newValue: 'sat: 300 ppk', firstSeenAt: '2026-10-25T11:00:00Z' }] } })
    const f = feeDates('sat', d, NOW)!
    expect(f.since).toBeNull()
    expect(f.pending?.text).toBe(`seen 1h ago, ${NOT_CONFIRMED}`)
    expect(f.pending?.title).toMatch(/300 ppk/)
  })
})

describe('infoDates', () => {
  it('pubkey "since" only when a pubkey change is recorded', () => {
    expect(infoDates('pubkey', data(), NOW).changed).toBeNull()
    const d = data({ changes: [ch('pubkey_changed', '02aa', '03bb', '2026-10-22T09:00:00Z', 'pubkey')] })
    expect(infoDates('pubkey', d, NOW).changed?.label).toBe(lbl('2026-10-22T09:00:00Z'))
  })

  it('MOTD "last changed" is the newest motd_changed', () => {
    const d = data({ changes: [
      ch('motd_changed', 'b', 'c', '2026-10-24T09:00:00Z', 'motd'),
      ch('motd_changed', 'a', 'b', '2026-10-18T09:00:00Z', 'motd'),
    ] })
    expect(infoDates('motd', d, NOW).changed?.label).toBe(lbl('2026-10-24T09:00:00Z'))
  })

  it('name / description: the date only as a title', () => {
    expect(infoTitle(infoDates('name', data(), NOW))).toBeUndefined()
    const d = data({ changes: [ch('name_changed', 'Old', 'New', '2026-10-19T09:00:00Z', 'name')] })
    expect(infoTitle(infoDates('name', d, NOW))).toMatch(/^Last changed .*19 Oct 2026, 09:00 UTC, confirmed .*19 Oct 2026, 10:00 UTC$/)
  })

  it('a confirmed change is dated by firstSeenAt; the confirming observedAt is only in the title', () => {
    const d = data({ changes: [ch('pubkey_changed', '02aa', '03bb', '2026-10-22T09:00:00Z', 'pubkey')] })
    const m = changeMark(d.changes[0]!, NOW)
    expect(m.label).toBe(lbl('2026-10-22T09:00:00Z'))
    expect(m.title).toMatch(/22 Oct 2026, 09:00 UTC, confirmed .*\(your time\) · 22 Oct 2026, 10:00 UTC$/)
    expect(infoDates('pubkey', d, NOW).changed).toEqual(m)
  })
})

describe('parseMintChanges', () => {
  it('reads pending and keysetsSeen; both are optional', () => {
    const r = parseMintChanges({ url: 'u', trackingSince: TRACK, changes: [], pending: { firstSeenAt: TRACK, diff: [{ type: 'motd_changed', field: 'motd', oldValue: 'a', newValue: 'b', firstSeenAt: TRACK }] }, keysetsSeen: [{ id: A, firstSeenAt: TRACK, lastSeenAt: TRACK }] })!
    expect(r.pending?.diff).toHaveLength(1)
    expect(r.keysetsSeen).toEqual([{ id: A, firstSeenAt: TRACK, lastSeenAt: TRACK }])
    const bare = parseMintChanges({ changes: [] })!
    expect(bare.pending).toBeNull()
    expect(bare.keysetsSeen).toEqual([])
    expect(parseMintChanges({ changes: 'x' })).toBeNull()
  })
})

describe('MintFeesLimits with change dates', () => {
  const props = {
    keysets: [{ unit: 'sat', active: true, inputFeePpk: 200 }, { unit: 'usd', active: true, inputFeePpk: 0 }],
    keysetsPending: false, units: ['sat', 'usd'], mintMethods: [], meltMethods: [],
    disabled: { mint: false, melt: false }, fetchedAt: null, now: NOW,
  }
  const changes = [
    ch('input_fee_changed', 'sat: 100 ppk, usd: 0 ppk', 'sat: 200 ppk, usd: 0 ppk', '2026-10-23T09:00:00Z', 'fees'),
    ch('input_fee_changed', 'sat: 0 ppk, usd: 0 ppk', 'sat: 100 ppk, usd: 0 ppk', '2026-10-20T09:00:00Z', 'fees'),
  ]

  it('shows "since", the unchanged fallback and a fee history toggle', () => {
    render(<MintFeesLimits {...props} changes={data({ changes })} />)
    const sat = screen.getByTestId('fee-row-sat')
    expect(sat.querySelector('[data-testid="fee-since"]')?.textContent).toBe(`since ${lbl('2026-10-23T09:00:00Z')}`)
    expect(screen.getByTestId('fee-row-usd').querySelector('[data-testid="fee-unchanged"]')?.textContent).toBe(`unchanged since ${lbl(TRACK)}`)
    expect(screen.queryByTestId('fee-history')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Show fee history' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByTestId('fee-history').querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Hide fee history' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('without the change data no dates show', () => {
    render(<MintFeesLimits {...props} />)
    expect(screen.queryByTestId('fee-since')).toBeNull()
    expect(screen.queryByTestId('fee-unchanged')).toBeNull()
  })
})

describe('after the backfill deploy (mint.lnpay.cz): pending keyset and fee changes, keysetsSeen present', () => {
  // The backfill stores the last keysets check as pending: 01cbb9 added (active, 200 ppk), 004558 deactivated, fee sat 100 -> 200.
  const NEW = '01cbb9af40e36ae5eff136308e1052c46f49837121dacf117845ec760bcefb1ac9'
  const OLD = '004558e8362903b1'
  const FREE = '00534ab3e6b75ca1'
  const SEEN_AT = '2026-10-25T10:00:00.000Z'
  const lnpay = (changes: MintChange[] = []) => data({
    trackingSince: '2026-10-20T21:35:03.220Z',
    changes,
    pending: { firstSeenAt: SEEN_AT, diff: [
      { type: 'keyset_added', field: 'keysets', oldValue: null, newValue: `${NEW} (sat, active, 200 ppk)`, firstSeenAt: SEEN_AT },
      { type: 'keyset_deactivated', field: 'keysets', oldValue: `${OLD} (sat, active, 100 ppk)`, newValue: `${OLD} (sat, inactive, 100 ppk)`, firstSeenAt: SEEN_AT },
      { type: 'input_fee_changed', field: 'fees', oldValue: 'sat: 100 ppk', newValue: 'sat: 200 ppk', firstSeenAt: SEEN_AT },
    ] },
    keysetsSeen: [
      { id: NEW, firstSeenAt: '2026-10-20T21:35:03.220Z', lastSeenAt: SEEN_AT },
      { id: OLD, firstSeenAt: '2026-10-20T21:35:03.220Z', lastSeenAt: SEEN_AT },
      { id: FREE, firstSeenAt: '2026-10-20T21:35:03.220Z', lastSeenAt: SEEN_AT },
    ],
  })

  it('the new keyset shows only the pending tag, never "Active since before ..."', () => {
    expect(keysetDates(NEW, true, lnpay(), NOW)).toBeNull()
    expect(keysetPending(NEW, lnpay(), NOW)?.text).toBe(`seen 2h ago, ${NOT_CONFIRMED}`)
  })

  it('the deactivated keyset shows only the pending tag, never "first seen inactive ..." or a range', () => {
    expect(keysetDates(OLD, false, lnpay(), NOW)).toBeNull()
    expect(keysetDates(OLD, true, lnpay(), NOW)).toBeNull()
    expect(keysetPending(OLD, lnpay(), NOW)?.title).toMatch(/^Deactivation seen once/)
  })

  it('a keyset the pending change does not touch keeps its dates', () => {
    expect(keysetDates(FREE, false, lnpay(), NOW)?.text).toBe(`inactive, first seen inactive ${lbl('2026-10-20T21:35:03.220Z')}`)
    expect(keysetPending(FREE, lnpay(), NOW)).toBeNull()
  })

  it('a confirmed earlier date of the keyset stays next to the pending tag', () => {
    const d = lnpay([ch('keyset_added', null, `${OLD} (sat, active, 100 ppk)`, '2026-10-21T09:00:00Z')])
    expect(keysetDates(OLD, true, d, NOW)?.text).toBe(`Active since ${lbl('2026-10-21T09:00:00Z')}`)
  })

  it('the sat fee shows only the pending tag, never "unchanged since ..."', () => {
    const f = feeDates('sat', lnpay(), NOW)!
    expect(f.unchangedSince).toBeNull()
    expect(f.since).toBeNull()
    expect(f.pending?.text).toBe(`seen 2h ago, ${NOT_CONFIRMED}`)
    expect(f.pending?.title).toMatch(/New fee 200 ppk/)
  })

  it('a previous confirmed fee change still dates "since" and keeps its history next to the pending tag', () => {
    const f = feeDates('sat', lnpay([ch('input_fee_changed', 'sat: 0 ppk', 'sat: 100 ppk', '2026-10-22T09:00:00Z', 'fees')]), NOW)!
    expect(f.since?.label).toBe(lbl('2026-10-22T09:00:00Z'))
    expect(f.unchangedSince).toBeNull()
    expect(f.history).toHaveLength(1)
    expect(f.pending).not.toBeNull()
  })

  it('the Fees and limits card renders the tag and no "unchanged since" for sat', () => {
    render(<MintFeesLimits keysets={[{ unit: 'sat', active: true, inputFeePpk: 200 }]} keysetsPending={false} units={['sat']} mintMethods={[]} meltMethods={[]}
      disabled={{ mint: false, melt: false }} fetchedAt={null} now={NOW} changes={lnpay()} />)
    const sat = screen.getByTestId('fee-row-sat')
    expect(sat.querySelector('[data-testid="fee-unchanged"]')).toBeNull()
    expect(sat.querySelector('[data-testid="fee-since"]')).toBeNull()
    expect(sat.querySelector('[data-testid="pending-tag"]')?.textContent).toBe(`seen 2h ago, ${NOT_CONFIRMED}`)
  })
})

describe('the Changes panel is gone and the record buttons match', () => {
  const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
  it('Mint Detail no longer renders the change log panel', () => {
    const page = src('pages/MintDetail.tsx')
    expect(page).not.toMatch(/MintChangeLog|No changes to keys, fees or keysets recorded since/)
  })
  it('"View on Nostr" and "Copy naddr" share one compact height, padding, font size and line height, also on touch', () => {
    const css = src('pages/MintDetail.css')
    expect(css).toMatch(/\.md-hr-view, \.md-hr-value \.doc-copy-btn \{ position: relative; height: 32px; min-height: 32px; padding: 6px 12px; box-sizing: border-box; font-family: inherit; font-size: 12px; line-height: 1;/)
    const touch = css.slice(css.indexOf('@media (pointer: coarse)', css.indexOf('.md-hr-dev-note')))
    expect(touch).toMatch(/\.md-hr-view, \.md-hr-value \.doc-copy-btn \{ height: 32px; min-height: 32px; padding: 6px 12px; \}/)
    // the visual size stays compact; an invisible pseudo-element keeps a 44px tall tap area
    expect(touch).toMatch(/\.md-hr-view::after, \.md-hr-value \.doc-copy-btn::after \{ content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 44px;/)
    expect(css).not.toMatch(/\.md-hr-view, \.md-hr-value \.doc-copy-btn \{ height: 44px/)
  })
})
