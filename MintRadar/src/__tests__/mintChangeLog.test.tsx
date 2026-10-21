// Mint Detail "Change log": the pure helpers and the panel's states (loading placeholder, calm error, empty with the tracking
// date, rows with a plain-words type and old → new, relative time with the absolute UTC time in `title`, "seen first" only for a
// late confirmation, the 10-row limit with "Show all").
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MintChangeLog, CHANGE_LOG_ERROR, CHANGE_LOG_EMPTY } from '@/components/mint/MintChangeLog'
import {
  CHANGE_LABELS, CHANGES_VISIBLE, changeLabel, webChangeRows, changeLogEmptySince, confirmationGapMs, parseMintChanges, showFirstSeen, type MintChange,
} from '@/utils/mintChangeLog'

const MINT = 'https://mint.example.com'
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const iso = (msAgo: number): string => new Date(NOW - msAgo).toISOString()
const change = (i: number, o: Partial<MintChange> = {}): MintChange => ({
  type: 'motd_changed', field: 'motd', oldValue: `old ${i}`, newValue: `new ${i}`, observedAt: iso(i * 3_600_000), firstSeenAt: iso(i * 3_600_000 + 300_000), ...o,
})

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

function renderLog(answer: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(answer))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MintChangeLog url={MINT} /></QueryClientProvider>)
}
const ok = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))

describe('helpers', () => {
  it('every backend change type has a plain-words label; an unknown one reads as a neutral sentence', () => {
    for (const t of ['pubkey_changed', 'input_fee_changed', 'keyset_added', 'keyset_removed', 'keyset_deactivated', 'keyset_reactivated', 'keyset_final_expiry_changed', 'motd_changed', 'name_changed', 'description_changed', 'contact_changed', 'version_changed', 'nuts_changed', 'methods_changed']) {
      expect(CHANGE_LABELS[t], t).toMatch(/^[A-Z][a-z]/)
    }
    expect(changeLabel('something_new')).toBe('Change recorded')
    expect(Object.values(CHANGE_LABELS).join(' ')).not.toMatch(/suspicious|warning|unsafe|scam|danger|risk|bad|good/i)
  })

  it('"seen first" only when the confirmation took clearly longer than one interval (5 min info, 1 h keysets)', () => {
    expect(confirmationGapMs('pubkey_changed')).toBeLessThan(confirmationGapMs('keyset_added'))
    expect(showFirstSeen(change(1, { firstSeenAt: iso(3_600_000 + 5 * 60_000) }))).toBe(false)
    expect(showFirstSeen(change(1, { firstSeenAt: iso(3_600_000 + 3 * 3_600_000) }))).toBe(true)
    expect(showFirstSeen(change(1, { type: 'keyset_added', firstSeenAt: iso(3_600_000 + 60 * 60_000) }))).toBe(false)
    expect(showFirstSeen(change(1, { type: 'input_fee_changed', firstSeenAt: iso(3_600_000 + 5 * 3_600_000) }))).toBe(true)
    expect(showFirstSeen(change(1, { firstSeenAt: 'garbage' }))).toBe(false)
  })

  it('parseMintChanges accepts the route answer and rejects any other shape (an odd answer is never "no changes")', () => {
    expect(parseMintChanges({ url: MINT, trackingSince: null, changes: [] })).toEqual({ url: MINT, trackingSince: null, changes: [] })
    expect(parseMintChanges({ changes: [{ type: 'motd_changed', field: 'motd', oldValue: null, newValue: 'x', observedAt: 'a', firstSeenAt: 'b' }] })!.changes[0]!.oldValue).toBeNull()
    for (const bad of [null, 'x', {}, { changes: 'no' }, { changes: [null] }, { changes: [{ type: 1 }] }]) expect(parseMintChanges(bad)).toBeNull()
  })
})

describe('web list helpers', () => {
  it('webChangeRows drops version_changed only and keeps the order', () => {
    const rows = [change(1), change(2, { type: 'version_changed' }), change(3, { type: 'pubkey_changed' })]
    expect(webChangeRows(rows).map(c => c.type)).toEqual(['motd_changed', 'pubkey_changed'])
  })
  it('the muted line names keys, fees and keysets and the date', () => {
    expect(changeLogEmptySince('5 Oct 2026')).toBe('No changes to keys, fees or keysets recorded since 5 Oct 2026.')
  })
})

describe('MintChangeLog', () => {
  it('while loading: no card and no text, only a line-high placeholder', () => {
    renderLog(() => new Promise<Response>(() => undefined))
    const loading = screen.getByTestId('change-log-loading')
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading.textContent).toBe('')
    expect(screen.queryByTestId('change-log')).toBeNull()
  })

  it('empty: no card, one muted line with the tracking date when the route has it', async () => {
    renderLog(ok({ url: MINT, trackingSince: '2026-10-05T08:00:00.000Z', changes: [] }))
    expect(await screen.findByText('No changes to keys, fees or keysets recorded since 5 Oct 2026.')).toBeInTheDocument()
    expect(screen.queryByTestId('change-log')).toBeNull()
    expect(screen.queryByText('Change log')).toBeNull()
  })

  it('empty without a tracking date: "No changes recorded yet."', async () => {
    renderLog(ok({ url: MINT, trackingSince: null, changes: [] }))
    expect(await screen.findByText(CHANGE_LOG_EMPTY)).toBeInTheDocument()
    expect(screen.queryByTestId('change-log')).toBeNull()
  })

  it('version_changed rows are not listed; only those: the same muted line, no card', async () => {
    renderLog(ok({ url: MINT, trackingSince: '2026-10-05T08:00:00.000Z', changes: [change(1, { type: 'version_changed', field: 'version' })] }))
    expect(await screen.findByTestId('change-log-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('change-log')).toBeNull()
  })

  it('version_changed rows are skipped before the 10-row limit and the "Show all" count', async () => {
    const rows = [...Array.from({ length: 4 }, (_, i) => change(i + 1, { type: 'version_changed', field: 'version', newValue: 'v' })), ...Array.from({ length: 12 }, (_, i) => change(i + 5))]
    renderLog(ok({ url: MINT, trackingSince: null, changes: rows }))
    await screen.findAllByTestId('change-row')
    expect(screen.getAllByTestId('change-row')).toHaveLength(CHANGES_VISIBLE)
    expect(screen.queryByText('Version changed')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all (12)' })).toBeInTheDocument()
  })

  it('a failed request is a calm sentence with Try again, not an empty log', async () => {
    renderLog(() => Promise.resolve(new Response('boom', { status: 500 })))
    expect(await screen.findByRole('alert')).toHaveTextContent(CHANGE_LOG_ERROR)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText(CHANGE_LOG_EMPTY)).toBeNull()
    expect(document.body.textContent).not.toContain('boom')
  })

  it('an answer in the wrong shape is the same calm error', async () => {
    renderLog(ok({ nope: true }))
    expect(await screen.findByRole('alert')).toHaveTextContent(CHANGE_LOG_ERROR)
  })

  it('rows: type in plain words, old → new, relative time with the absolute UTC time in title', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    renderLog(ok({ url: MINT, trackingSince: null, changes: [change(2, { type: 'pubkey_changed', oldValue: 'aa', newValue: 'bb' })] }))
    const row = await screen.findByTestId('change-row')
    expect(within(row).getByText('Public key changed')).toBeInTheDocument()
    expect(row.querySelector('.md-change-old')).toHaveTextContent('aa')
    expect(row.querySelector('.md-change-new')).toHaveTextContent('bb')
    const time = row.querySelector('time.md-change-time')!
    expect(time).toHaveTextContent(/ago$/)
    expect(time.getAttribute('title')).toMatch(/^\d{1,2} [A-Z][a-z]{2} 2026, \d{2}:\d{2} UTC$/)
    expect(time.getAttribute('datetime')).toBe(iso(2 * 3_600_000))
    expect(row.querySelector('.md-change-first')).toBeNull() // confirmed one interval after the first sighting
  })

  it('a missing side shows a dash; the day-summary row shows only its text', async () => {
    renderLog(ok({ url: MINT, trackingSince: null, changes: [
      change(1, { type: 'keyset_added', field: 'keyset', oldValue: null, newValue: '00ab (sat, active)' }),
      change(2, { oldValue: null, newValue: 'multiple changes' }),
    ] }))
    const rows = await screen.findAllByTestId('change-row')
    expect(rows[0]!.querySelector('.md-change-old')).toHaveTextContent('—')
    expect(rows[1]!.querySelector('.md-change-merged')).toHaveTextContent('multiple changes')
    expect(rows[1]!.querySelector('.md-change-arrow')).toBeNull()
  })

  it('"seen first" appears for a late confirmation, with its own UTC title', async () => {
    renderLog(ok({ url: MINT, trackingSince: null, changes: [change(1, { firstSeenAt: iso(3_600_000 + 4 * 3_600_000) })] }))
    const row = await screen.findByTestId('change-row')
    const first = row.querySelector('.md-change-first')!
    expect(first).toHaveTextContent(/^seen first .* ago$/)
    expect(first.querySelector('time')!.getAttribute('title')).toMatch(/UTC$/)
  })

  it(`shows the newest ${CHANGES_VISIBLE}; "Show all (N)" expands to everything the route returned and "Show fewer" folds it back`, async () => {
    renderLog(ok({ url: MINT, trackingSince: null, changes: Array.from({ length: 60 }, (_, i) => change(i + 1)) }))
    await screen.findAllByTestId('change-row')
    expect(screen.getAllByTestId('change-row')).toHaveLength(CHANGES_VISIBLE)
    const toggle = screen.getByRole('button', { name: 'Show all (60)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getAllByTestId('change-row')).toHaveLength(60)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByTestId('change-row')).toHaveLength(CHANGES_VISIBLE)
  })

  it('no toggle when there are 10 or fewer', async () => {
    renderLog(ok({ url: MINT, trackingSince: null, changes: Array.from({ length: CHANGES_VISIBLE }, (_, i) => change(i + 1)) }))
    await screen.findAllByTestId('change-row')
    expect(screen.queryByRole('button', { name: /Show/ })).toBeNull()
  })

  it('requests only the one route, for this mint', async () => {
    renderLog(ok({ url: MINT, trackingSince: null, changes: [] }))
    await screen.findByText(CHANGE_LOG_EMPTY)
    const f = fetch as unknown as ReturnType<typeof vi.fn>
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0]![0]).toBe(`/api/mints/changes?url=${encodeURIComponent(MINT)}`)
  })
})
