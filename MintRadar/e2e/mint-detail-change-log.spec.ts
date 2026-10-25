import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Mint Detail has no "Changes" panel any more: the dates of confirmed changes (/api/mints/changes) show where the data lives —
// the keyset rows ("Active since", inactive ranges), the Fees and limits card ("since", "Show fee history", "unchanged since"),
// the Mint info public key ("since", only when a change exists) and the MOTD ("last changed"). A value seen once is the
// muted "seen <time>, not confirmed yet" tag, never a date. utils/changeDates.ts has the rules; this spec checks the wiring.

const ALPHA = 'https://alpha.mint.example'
const H = 3_600_000
const T0 = Date.now()
const ago = (ms: number) => new Date(T0 - ms).toISOString()
const SINCE = ago(20 * 24 * H)
const ACTIVE = '00ad268c4d1f5826'
const OLD = '00c074b96c7e2b0e'
const OLDER = '00ffeeddccbbaa99'
const PUBKEY = '02' + 'ab'.repeat(32)

interface Row { type: string; field: string; oldValue: string | null; newValue: string | null; observedAt: string; firstSeenAt: string }
const row = (msAgo: number, o: Omit<Row, 'observedAt' | 'firstSeenAt'>): Row => ({ ...o, firstSeenAt: ago(msAgo), observedAt: ago(msAgo - H) })

const CHANGES: Row[] = [
  row(2 * 24 * H, { type: 'input_fee_changed', field: 'fees', oldValue: 'sat: 50 ppk', newValue: 'sat: 100 ppk' }),
  row(3 * 24 * H, { type: 'pubkey_changed', field: 'pubkey', oldValue: '03' + 'cd'.repeat(32), newValue: PUBKEY }),
  row(4 * 24 * H, { type: 'motd_changed', field: 'motd', oldValue: 'old', newValue: 'Welcome' }),
  row(5 * 24 * H, { type: 'keyset_deactivated', field: 'keysets', oldValue: `${OLD} (sat, active, 50 ppk)`, newValue: `${OLD} (sat, inactive, 50 ppk)` }),
  row(5 * 24 * H, { type: 'keyset_added', field: 'keysets', oldValue: null, newValue: `${ACTIVE} (sat, active, 100 ppk)` }),
]
const answer = (over: Record<string, unknown> = {}) => ({
  url: ALPHA, trackingSince: SINCE, changes: CHANGES,
  keysetsSeen: [
    { id: ACTIVE, firstSeenAt: ago(5 * 24 * H), lastSeenAt: ago(H) },
    { id: OLD, firstSeenAt: ago(30 * 24 * H), lastSeenAt: ago(H) },
    { id: OLDER, firstSeenAt: ago(10 * 24 * H), lastSeenAt: ago(H) },
  ],
  ...over,
})

function probe() {
  return {
    url: ALPHA, online: true, latencyMs: 40,
    info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', pubkey: PUBKEY, motd: 'Welcome', nuts: { '4': {}, '5': {} } },
    keysets: [
      { id: ACTIVE, unit: 'sat', active: true, input_fee_ppk: 100 },
      { id: OLD, unit: 'sat', active: false, input_fee_ppk: 50 },
      { id: OLDER, unit: 'sat', active: false, input_fee_ppk: 0 },
    ],
    checkedAt: new Date().toISOString(),
  }
}

async function open(page: Page, body: unknown = answer(), width = 1440) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS }))
  await page.route('**/api/mint/probe**', r => r.fulfill({ json: probe() }))
  await page.route('**/api/mints/changes**', r => r.fulfill({ json: body }))
  await resize(page, width, 900)
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
}

const keysetRow = (page: Page, id: string) => page.locator('.md-keyset-row:visible', { hasText: id.slice(0, 8) })
const tab = (page: Page, name: RegExp) => page.locator('.md-tab', { hasText: name }).click()

test('the History tab no longer renders a Changes panel or its empty line', async ({ page }) => {
  await open(page, answer({ changes: [] }))
  await tab(page, /^History/)
  await expect(page.locator('.md-panel-title', { hasText: /^Version history$/ })).toBeVisible()
  await expect(page.getByTestId('change-log')).toHaveCount(0)
  await expect(page.getByTestId('change-log-empty')).toHaveCount(0)
  await expect(page.getByText(/No changes to keys, fees or keysets recorded/)).toHaveCount(0)
  await expect(page.locator('.md-panel-title', { hasText: /^(Change log|Changes)$/ })).toHaveCount(0)
})

test('keysets: "Active since", inactive ranges and "first seen inactive", local date with the UTC time in the title', async ({ page }) => {
  await open(page)
  const active = keysetRow(page, ACTIVE).getByTestId('keyset-dates')
  await expect(active).toHaveText(/^Active since \d{1,2} [A-Z][a-z]{2}( \d{4})?$/)
  await expect(active.locator('.md-chg-date')).toHaveAttribute('title', /UTC$/)
  await page.getByRole('button', { name: 'Show 2 inactive keysets' }).click()
  await expect(keysetRow(page, OLD).getByTestId('keyset-dates')).toHaveText(/^before \d{1,2} [A-Z][a-z]{2}( \d{4})? – \d{1,2} [A-Z][a-z]{2}( \d{4})?$/)
  await expect(keysetRow(page, OLDER).getByTestId('keyset-dates')).toHaveText(/^inactive, first seen inactive \d{1,2} [A-Z][a-z]{2}/)
})

test('fees: "since" the last change, the fee history toggle, "unchanged since" without a change', async ({ page }) => {
  await open(page)
  await tab(page, /^NUTs/)
  const sat = page.getByTestId('fee-row-sat')
  await expect(sat.getByTestId('fee-since')).toHaveText(/^since \d{1,2} [A-Z][a-z]{2}/)
  await sat.getByRole('button', { name: 'Show fee history' }).click()
  await expect(sat.getByTestId('fee-history').locator('li')).toHaveText([/^50 ppk · 0\.05 sat per coin · before .+ – .+$/])
})

test('fees: no recorded change shows "unchanged since <tracking start>"', async ({ page }) => {
  await open(page, answer({ changes: [] }))
  await tab(page, /^NUTs/)
  await expect(page.getByTestId('fee-row-sat').getByTestId('fee-unchanged')).toHaveText(/^unchanged since \d{1,2} [A-Z][a-z]{2}/)
  await expect(page.getByRole('button', { name: 'Show fee history' })).toHaveCount(0)
})

test('mint info: public key "since" only with a recorded change; MOTD "last changed"', async ({ page }) => {
  await open(page)
  await expect(page.getByTestId('pubkey-since')).toHaveText(/^since \d{1,2} [A-Z][a-z]{2}/)
  await expect(page.getByTestId('motd-changed')).toHaveText(/^last changed \d{1,2} [A-Z][a-z]{2}/)
})

test('mint info: no change recorded, no pubkey or MOTD date', async ({ page }) => {
  await open(page, answer({ changes: [] }))
  await expect(page.locator('.md-panel-title', { hasText: /^Mint info$/ })).toBeVisible()
  await expect(page.getByTestId('pubkey-dates')).toHaveCount(0)
  await expect(page.getByTestId('motd-dates')).toHaveCount(0)
})

test('a value seen once is the "seen …, not confirmed yet" tag, not a date', async ({ page }) => {
  const seen = ago(2 * H)
  await open(page, answer({ changes: [], pending: { firstSeenAt: seen, diff: [{ type: 'pubkey_changed', field: 'pubkey', oldValue: PUBKEY, newValue: '03' + 'ef'.repeat(32), firstSeenAt: seen }] } }))
  const dates = page.getByTestId('pubkey-dates')
  await expect(dates.getByTestId('pending-tag')).toHaveText('seen 2h ago, not confirmed yet')
  await expect(page.getByTestId('pubkey-since')).toHaveCount(0)
})

test('"View on Nostr" and "Copy naddr" have the same height, padding and font size', async ({ page }) => {
  await open(page)
  const rowEl = page.locator('.md-hr-row')
  await expect(rowEl.locator('.md-hr-view')).toBeVisible()
  await layoutReady(page)
  const m = await rowEl.evaluate(el => {
    const pick = (sel: string) => {
      const n = el.querySelector<HTMLElement>(sel)!
      const cs = getComputedStyle(n)
      return { h: n.getBoundingClientRect().height, pad: `${cs.paddingTop} ${cs.paddingRight}`, fs: cs.fontSize }
    }
    return { view: pick('.md-hr-view'), copy: pick('.md-hr-value .doc-copy-btn') }
  })
  expect(m.view).toEqual(m.copy)
})
