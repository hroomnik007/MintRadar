import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'

// Compare modal rows after "No mint fault (7d)": the five score components with their points, the contact methods (kinds only)
// and the NIP-87 announcement. src/utils/compareScoreRows.ts, ComparisonModal.tsx.

const [ALPHA, BRAVO, , DELTA] = MOCK_MINTS.map(m => m.url) as [string, string, string, string]
const parts = (u: number, n: number, v: number) => ({ uptime: { points: u, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: n, max: 15 }, version: { points: v, max: 15 }, contact: { points: 3, max: 5 }, newMintCap: { points: 0, cap: 70 }, sum: 0 })
// Alpha and Bravo have a stored breakdown, Delta has no stored score; only Alpha has a stored announcement.
const KNOWN = MOCK_KNOWN_MINTS.map(m => m.url === ALPHA
  ? { ...m, scoreBreakdown: parts(40, 12, 15), nostrAnnouncedAt: '2026-03-14T09:30:00.000Z' }
  : m.url === BRAVO ? { ...m, scoreBreakdown: parts(30, 8, 10), nostrAnnouncedAt: null }
  : m.url === DELTA ? { ...m, reliabilityScore: null, scoreBreakdown: null, nostrAnnouncedAt: null }
  : m)
const CONTACTS: Record<string, { method: string; info: string }[]> = {
  [ALPHA]: [{ method: 'nostr', info: 'npub1secretalpha' }, { method: 'email', info: 'secret@alpha.example' }],
  [BRAVO]: [{ method: 'twitter', info: '@secretbravo' }],
  [DELTA]: [],
}
const ORDER = ['uptime-points', 'audit-points', 'nut-points', 'version-points', 'contact-points', 'contact-methods', 'nip87']
const LABELS = ['Uptime points', 'Audit points', 'NUT support points', 'Version points', 'Contact points', 'Contact methods', 'NIP-87 announcement']

async function openCompare(page: Page, size: [number, number], others: string[], hold?: { release: () => void; promise: Promise<void> }) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
  await page.route('**/api/mint/probe**', async route => {
    if (hold) await hold.promise
    const target = new URL(route.request().url()).searchParams.get('url')!
    route.fulfill({ json: { url: target, online: true, latencyMs: 50, checkedAt: new Date().toISOString(), info: { name: 'Mint', nuts: {}, contact: CONTACTS[target] ?? [] }, keysets: [] } })
  })
  await page.setViewportSize({ width: size[0], height: size[1] })
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
  for (const name of others) await page.locator('.md-picker-item', { hasText: name }).click()
  await page.locator('.md-picker-confirm').click()
  await expect(page.getByText('Mint Comparison')).toBeVisible()
}

// One accessor for both layouts: label list and the values of a row.
const isPhone = (size: [number, number]) => size[0] <= 768
const labels = (page: Page, phone: boolean) => phone
  ? page.locator('table.cmp-m-table tbody tr th[scope="row"]').allInnerTexts()
  : page.locator('.cmp-grid .cmp-lbl').allInnerTexts()
const values = async (page: Page, phone: boolean, id: string) => (phone
  ? await page.locator(`table.cmp-m-table tbody tr[data-row="${id}"] td`).allInnerTexts()
  : await page.locator(`.cmp-grid .cmp-val[data-row="${id}"]`).allInnerTexts()).map(t => t.trim())
const rowCount = (page: Page, phone: boolean, id: string) => phone
  ? page.locator(`table.cmp-m-table tbody tr[data-row="${id}"]`).count()
  : page.locator(`.cmp-grid .cmp-val[data-row="${id}"]`).count()

for (const size of [[1440, 900], [390, 844]] as [number, number][]) {
  const phone = isPhone(size)
  test(`${size[0]}px: the rows follow the audit row in the specified order with the right values (Alpha, Bravo, Delta)`, async ({ page }) => {
    await openCompare(page, size, ['Bravo Mint', 'Delta Mint'])
    const l = (await labels(page, phone)).map(t => t.trim().replace(/\s+/g, ' '))
    const at = l.findIndex(t => t.toLowerCase().startsWith('no mint fault'))
    expect(l.slice(at + 1, at + 8).map(t => t.toLowerCase())).toEqual(LABELS.map(t => t.toLowerCase()))
    expect(l[at + 8]?.toLowerCase()).toContain('backup')
    expect(await values(page, phone, 'uptime-points')).toEqual(['40 / 40', '30 / 40', '—'])
    expect(await values(page, phone, 'audit-points')).toEqual(['25 / 25', '25 / 25', '—'])
    expect(await values(page, phone, 'nut-points')).toEqual(['12 / 15', '8 / 15', '—'])
    expect(await values(page, phone, 'version-points')).toEqual(['15 / 15', '10 / 15', '—'])
    expect(await values(page, phone, 'contact-points')).toEqual(['3 / 5', '3 / 5', '—'])
    expect(await values(page, phone, 'nip87')).toEqual(['Seen · event dated 14 Mar 2026', 'Not seen on our relays', 'Not seen on our relays'])
    await expect.poll(() => values(page, phone, 'contact-methods')).toEqual(['Email · Nostr', 'Twitter', 'None listed'])
    // Kinds only: no address anywhere in the modal.
    const text = await page.locator('.cmp-modal').innerText()
    expect(text).not.toMatch(/secretalpha|secretbravo|secret@alpha/)
    // Nothing overflows the page.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test(`${size[0]}px: "Only differences" hides a new row when the mints agree and keeps it when they differ`, async ({ page }) => {
    await openCompare(page, size, ['Bravo Mint'])
    await expect.poll(() => values(page, phone, 'contact-methods')).toEqual(['Email · Nostr', 'Twitter'])
    for (const id of ORDER) expect(await rowCount(page, phone, id)).toBeGreaterThan(0)
    await page.getByRole('switch', { name: 'Only differences' }).click()
    // Alpha and Bravo: same audit and contact points, different everything else in the new rows.
    expect(await rowCount(page, phone, 'audit-points')).toBe(0)
    expect(await rowCount(page, phone, 'contact-points')).toBe(0)
    for (const id of ['uptime-points', 'nut-points', 'version-points', 'contact-methods', 'nip87']) expect(await rowCount(page, phone, id), id).toBeGreaterThan(0)
    await page.getByRole('switch', { name: 'Only differences' }).click()
    for (const id of ORDER) expect(await rowCount(page, phone, id)).toBeGreaterThan(0)
  })

  test(`${size[0]}px: contact methods read "…" while the probe is held and the kinds once it answers`, async ({ page }) => {
    let release: () => void = () => undefined
    const promise = new Promise<void>(r => { release = r })
    await openCompare(page, size, ['Bravo Mint'], { release, promise })
    await expect.poll(() => values(page, phone, 'contact-methods')).toEqual(['…', '…'])
    // The score rows do not wait for the probe.
    expect(await values(page, phone, 'uptime-points')).toEqual(['40 / 40', '30 / 40'])
    // A row that is still loading stays under "Only differences".
    await page.getByRole('switch', { name: 'Only differences' }).click()
    expect(await rowCount(page, phone, 'contact-methods')).toBeGreaterThan(0)
    release()
    await expect.poll(() => values(page, phone, 'contact-methods')).toEqual(['Email · Nostr', 'Twitter'])
  })
}

test('the new rows cause no request of their own: one probe per mint, no contact or announcement request', async ({ page }) => {
  const seen: string[] = []
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) seen.push(u.pathname) })
  await openCompare(page, [1440, 900], ['Bravo Mint', 'Delta Mint'])
  await expect.poll(() => values(page, false, 'contact-methods')).toEqual(['Email · Nostr', 'Twitter', 'None listed'])
  await page.waitForLoadState('networkidle')
  const count = (p: string) => seen.filter(x => x === p).length
  // The modal's existing requests: one probe, 24h history, chart history and version history per mint (3 mints).
  expect(count('/api/mint/probe')).toBe(3)
  const allowed = new Set(['/api/mint/probe', '/api/mints/history', '/api/mints/version-history', '/api/mints/known', '/api/stats', '/api/mints/changes'])
  const extra = [...new Set(seen)].filter(p => !allowed.has(p) && !p.startsWith('/api/mint/icon') && !p.startsWith('/api/stats'))
  expect(extra).toEqual([])
  expect(seen.filter(p => /contact|nip87|announce/i.test(p))).toEqual([])
})
