import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, probePayload, makeCashuToken, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { DIMMED_MINTS } from './fixtures/dimmedCards'
import { scanBadges, type BadgeRecord } from './fixtures/badgeContrast'

// Every badge, chip, pill, tag and notice text reaches WCAG AA (4.5:1) as an EFFECTIVE colour (translucent
// backgrounds and opacity composited over the real backdrop), in default and hover state, on online / offline
// cards, Mint Detail, Stats, Wallets and the banners. Disabled controls are exempt (WCAG "inactive component"),
// the queued-banner "×" is an icon glyph (3:1). Animations are switched off so entry fades can't mask a rule.
test.setTimeout(180_000)

const SAME_PK = '03' + 'cd'.repeat(32)
const GRID = [
  ...DIMMED_MINTS.map((m, i) => (i === 0 || i === 3 ? { ...m, pubkey: SAME_PK } : m)),
  { ...DIMMED_MINTS[0], url: 'https://lowup.mint.example', name: 'Lowup Mint', reliabilityScore: 70, uptimePct24h: 40 },
  { ...DIMMED_MINTS[0], url: 'https://midup.mint.example', name: 'Midup Mint', reliabilityScore: 78, uptimePct24h: 85 },
]

async function setup(page: Page, mints: unknown[] = GRID) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: mints }))
}
async function scan(page: Page, hover = false): Promise<BadgeRecord[]> {
  await page.addStyleTag({ content: '*{animation:none !important;transition:none !important}' })
  await page.waitForTimeout(400)
  return scanBadges(page, 'default', { hover })
}
const floor = (r: BadgeRecord) => (r.sel.includes('queued-banner-dismiss') ? 3 : 4.5)
function assertAll(recs: BadgeRecord[], where: string) {
  for (const r of recs) {
    if (r.state.includes('disabled')) continue
    expect.soft(r.ratio, `${where}: ${r.sel} "${r.text}" [${r.state}] fg=${r.fg} bg=${r.bg}`).toBeGreaterThanOrEqual(floor(r))
  }
}
// The scan must really have reached the badges that used to fail — otherwise a green run would prove nothing.
function expectSeen(recs: BadgeRecord[], needles: [string, string | RegExp][], where: string) {
  for (const [sel, text] of needles) {
    const hit = recs.some(r => r.sel.includes(sel) && (typeof text === 'string' ? r.text === text : text.test(r.text)))
    expect.soft(hit, `${where}: scan reached ${sel} "${text}"`).toBe(true)
  }
}

for (const w of [1440, 390]) {
  test.describe(`${w}px`, () => {
    test.use({ viewport: { width: w, height: 900 } })

    test('dashboard cards: Test mint, New, Same op, up-24h tones, Offline 24h+, unit/LN chips', async ({ page }) => {
      await setup(page)
      await page.goto('/?testmints=show&status=all')
      await expect(page.locator('.mint-card')).toHaveCount(11)
      const recs = await scan(page, true)
      assertAll(recs, 'cards')
      expectSeen(recs, [
        ['card-reliability-badge-test-mint', 'Test mint'], ['card-reliability-badge-same-op', 'Same op'],
        ['card-hdr-new', 'New'], ['card-hdr-badge', 'Offline 24h+'], ['card-pill', '40 % up 24h'],
        ['card-pill', '85 % up 24h'], ['card-pill', '99 % up 24h'], ['card-pill', /^SAT$/],
      ], 'cards')
      if (w === 1440) expectSeen(recs, [['search-shortcut', '/']], 'cards')
    })

    test('Mint Detail: status, New, Test mint, alerts, disabled method chips, retry button', async ({ page }) => {
      const mints = [
        { ...DIMMED_MINTS[2], url: 'https://testnut.cashu.space', name: 'Testnut', discoveredAt: new Date().toISOString() },
        { ...DIMMED_MINTS[4], url: 'https://offerr.mint.example', name: 'Offerr', lastError: 'Connection timed out' },
      ]
      await setup(page, mints)
      await page.route('**/api/mint/probe**', r => {
        const url = new URL(r.request().url()).searchParams.get('url') ?? ''
        const p = probePayload(url) as { online: boolean; info: { motd: string; nuts: Record<string, unknown> } }
        if (url.includes('offerr')) p.online = false
        p.info.motd = 'Scheduled maintenance Friday'
        p.info.nuts['4'] = { methods: [], disabled: true }
        p.info.nuts['5'] = { methods: [], disabled: true }
        r.fulfill({ json: p })
      })
      await page.route('**/api/mints/swaps**', r => r.fulfill({ status: 500, json: {} }))
      const all: BadgeRecord[] = []
      for (const host of ['testnut.cashu.space', 'offerr.mint.example']) {
        await page.goto(`/mint/${encodeURIComponent(`https://${host}`)}`)
        await expect(page.locator('.md-tabs')).toBeVisible()
        for (const tab of ['overview', 'history', 'nuts', 'audit']) {
          await page.locator('.md-tab', { hasText: new RegExp(`^${tab}$`, 'i') }).click()
          if (tab === 'audit') await expect(page.locator('.audit-swaps-error-banner')).toBeVisible()
          all.push(...(await scan(page, tab === 'audit' || tab === 'nuts')))
        }
      }
      assertAll(all, 'detail')
      expectSeen(all, [
        ['md-age-badge-inline', 'New'], ['md-mint-alert-title', 'Operator notice'], ['md-error-badge', 'Connection timed out'],
        ['method-chip', 'bolt11'], ['audit-swaps-retry-btn', 'Retry'],
      ], 'detail')
      expect.soft(all.some(r => r.sel.includes('audit-swaps-retry-btn') && r.state.includes('hover')), 'retry hover state scanned').toBe(true)
    })

    test('Outdated badges (Mint Detail + Compare), Token Inspector Test mint badge', async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => ({ ...m, online: true, degraded: false })) }))
      await page.route('**/api/mints/version-history**', r => r.fulfill({ json: { history: [], latestGlobalVersion: 'nutshell/0.20' } }))
      const all: BadgeRecord[] = []
      await page.goto(`/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`)
      await expect(page.locator('.md-sc', { has: page.locator('.md-sc-sub', { hasText: 'software' }) }).getByText('Outdated')).toBeVisible()
      all.push(...(await scan(page)))
      await page.goto('/?status=all')
      await expect(page.locator('.mint-card')).toHaveCount(4)
      await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
      await page.locator('.md-picker-item', { hasText: 'Delta Mint' }).click()
      await page.locator('.md-picker-confirm').click()
      await expect(page.getByText('Mint Comparison')).toBeVisible()
      all.push(...(await scan(page)))
      await page.goto('/tools')
      await page.locator('.token-input').fill(makeCashuToken('https://testnut.cashu.space', [21]))
      await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
      await expect(page.locator('.token-test-mint-badge')).toBeVisible()
      all.push(...(await scan(page)))
      assertAll(all, 'outdated/token')
      expectSeen(all, [['', 'Outdated'], ['token-test-mint-badge', 'Test mint']], 'outdated/token')
    })

    test('Stats, Wallets and banners', async ({ page }) => {
      // GRID mints all run Nutshell/0.16.0 (outdated against the fixture's 0.20); one current mint adds the "latest" chip.
      await setup(page, [...GRID, { ...DIMMED_MINTS[0], url: 'https://current.mint.example', name: 'Current Mint', version: 'Nutshell/0.20.0' }])
      const all: BadgeRecord[] = []
      await page.goto('/stats')
      await expect(page.getByText('Software in Use')).toBeVisible()
      all.push(...(await scan(page)))
      await page.locator('.sw-row').first().click()
      all.push(...(await scan(page)))
      await page.goto('/wallets')
      await expect(page.locator('.wallet-platform-tag').first()).toBeVisible()
      all.push(...(await scan(page)))
      // Banners that need a failure state: rendered with the app's own classes on the app's own page backdrop.
      await page.goto('/watchlist')
      await page.evaluate(() => {
        const d = document.createElement('div')
        d.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:8px'
        d.innerHTML = `
          <div class="queued-banner queued-banner-info"><span>Queued: your mint will be probed</span><button class="queued-banner-dismiss">×</button></div>
          <div class="queued-banner queued-banner-success"><span>Added</span></div>
          <div class="wl-sync-error-banner">Couldn't sync with Nostr relays — showing local data.</div>
          <div class="bulk-progress">
            <div class="bulk-row status-added"><span class="bulk-url">a.example</span><span class="bulk-status">✓ Added</span></div>
            <div class="bulk-row status-failed"><span class="bulk-url">b.example</span><span class="bulk-status">✗ Failed</span></div>
            <div class="bulk-row status-duplicate"><span class="bulk-url">c.example</span><span class="bulk-status">• Already tracked</span></div>
          </div>`
        document.querySelector('.watchlist-page, main, body')!.prepend(d)
      })
      all.push(...(await scan(page)))
      assertAll(all, 'stats/wallets/banners')
      expectSeen(all, [
        ['stats-movers-delta', /-9/], ['wallet-platform-tag', 'Android'], ['bulk-status', '✗ Failed'],
        ['queued-banner-dismiss', '×'], ['wl-sync-error-banner', /Couldn't sync/], ['sw-badge', 'latest'], ['sw-badge', 'outdated'],
      ], 'stats/wallets/banners')
    })
  })
}
