import { test, expect } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

const ALPHA = MOCK_MINTS[0]!.url // https://alpha.mint.example
const detailPath = `/mint/${encodeURIComponent(ALPHA)}`

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
})

test.describe('Mint Detail', () => {
  test('shows the mint summary (latency, uptime, version, NUTs)', async ({ page }) => {
    // Header name from the probe info.
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()

    const summary = page.locator('.md-summary')
    await expect(summary).toContainText('50 ms')            // latency from known-mints
    await expect(summary).toContainText('99%')              // uptime 24h from history
    await expect(summary).toContainText('Nutshell/0.16.0')  // version
    // NUTs count = number of keys in the probe info.nuts (12 for Alpha).
    await expect(summary.locator('.md-sc-value.green')).toHaveText('12')
  })

  test('tab navigation switches panels', async ({ page }) => {
    const tab = (name: string) => page.locator('.md-tab', { hasText: name })

    // Overview is active by default.
    await expect(tab('Overview')).toHaveClass(/active/)

    await tab('History').click()
    await expect(tab('History')).toHaveClass(/active/)

    await tab('NUTs').click()
    await expect(tab('NUTs')).toHaveClass(/active/)

    await tab('Audit').click()
    await expect(tab('Audit')).toHaveClass(/active/)

    await tab('Reviews').click()
    await expect(tab('Reviews')).toHaveClass(/active/)
  })

  test('reviews tab shows an empty state when there are no reviews', async ({ page }) => {
    await page.locator('.md-tab', { hasText: 'Reviews' }).click()
    // Relays are stubbed empty and /api/mints/nostr-reviews returns [] → empty state.
    await expect(page.getByText('No Nostr reviews found for this mint yet.')).toBeVisible({ timeout: 15_000 })
    // The short "Reviews · NIP-87" label is shown even with zero reviews (it sits
    // above the loading/empty branch); the full sybil-inflation caveat now lives in
    // its InfoTooltip.
    await expect(page.locator('.reviews-disclaimer')).toContainText('Reviews · NIP-87')
    await page.locator('.reviews-disclaimer .info-tooltip').hover()
    await expect(page.locator('.reviews-disclaimer .info-tooltip-pop')).toContainText(
      /artificially inflated.*directional signal, not proof.*Counts may also differ/i
    )
    // No filter chips when there is nothing to filter.
    await expect(page.locator('.reviews-filter-chip')).toHaveCount(0)
  })

  test('Trust Score breakdown shows all 5 components inline on Overview, no click needed', async ({ page }) => {
    const panel = page.locator('.md-trust-panel')
    await expect(panel.getByText('Uptime (40%)')).toBeVisible()
    await expect(panel.getByText('Audit reliability (25%)')).toBeVisible()
    await expect(panel.getByText('NUT Support (15%)')).toBeVisible()
    await expect(panel.getByText('Version (15%)')).toBeVisible()
    await expect(panel.getByText('Contact (5%)')).toBeVisible()
    // The score formula moved into an (i) tooltip beside the panel title
    // (2026-09-20, to reclaim vertical space) instead of always being
    // visible as text.
    await panel.locator('.md-audit-info').hover()
    await expect(panel.getByText(/Score = Uptime×40%/)).toBeVisible()
  })

  test('Trust Score details modal still opens from the mobile compact tile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.md-sc.md-sc-trust').click()
    await expect(page.getByText('Trust Score Breakdown')).toBeVisible()
  })

  for (const viewport of [
    { label: 'desktop', size: { width: 1280, height: 900 } },
    { label: 'mobile', size: { width: 390, height: 844 } },
  ]) {
    test(`clicking the mint URL shares a link and shows "Link copied" feedback, no naddr available (${viewport.label})`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.setViewportSize(viewport.size)

      const urlBtn = page.locator('button.md-url-copy')
      await expect(urlBtn).toBeVisible()
      await expect(urlBtn).toContainText(ALPHA)
      await expect(urlBtn).not.toHaveClass(/copied/)
      await expect(urlBtn).not.toContainText('Link copied')

      await urlBtn.click()

      // Visual feedback: .copied class + a "Link copied" text label for ~2s
      // (not just an icon swap, so it reads on tap/mobile too).
      await expect(urlBtn).toHaveClass(/copied/)
      await expect(urlBtn).toContainText('Link copied')

      // ALPHA has no recorded Nostr announcement in the fixture, so the
      // share link falls back to the encoded-URL route (current page URL).
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      expect(clip).toContain(encodeURIComponent(ALPHA))
      expect(clip).toBe(page.url())

      // Feedback reverts.
      await expect(urlBtn).not.toHaveClass(/copied/, { timeout: 4000 })
      await expect(urlBtn).not.toContainText('Link copied', { timeout: 4000 })
    })
  }

  test('when the mint has a Nostr announcement, the shared link is a naddr deep link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const { MOCK_KNOWN_MINTS } = await import('./fixtures/mocks')
    const pubkey = 'a'.repeat(64)
    const dTag = 'alpha-announce'
    const naddr = nip19.naddrEncode({ kind: 38172, pubkey, identifier: dTag })
    await page.route('**/api/mints/known', r => r.fulfill({
      json: MOCK_KNOWN_MINTS.map(m =>
        m.url === ALPHA ? { ...m, nostrAnnouncePubkey: pubkey, nostrAnnounceD: dTag } : m),
    }))
    await page.goto(detailPath)
    await expect(page.locator('.md-tabs')).toBeVisible()

    const urlBtn = page.locator('button.md-url-copy')
    await urlBtn.click()
    await expect(urlBtn).toContainText('Link copied')

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe(`${new URL(page.url()).origin}/mint/nostr/${naddr}`)
  })
})

test.describe('Mint Detail — /mint/:url canonicalisation (bare-host collision fix)', () => {
  test.beforeEach(async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
  })

  test('a bare host redirects to the tracked mint (not a hollow stub)', async ({ page }) => {
    await page.goto('/mint/alpha.mint.example')
    // Ends on the canonical encoded URL the rest of the app links to…
    await expect(page).toHaveURL(u => u.pathname === `/mint/${encodeURIComponent(ALPHA)}`)
    // …showing the real tracked mint: full detail, online, real stats.
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
    await expect(page.locator('.md-status-inline')).toContainText('Online')
    await expect(page.locator('.md-summary').locator('.md-sc-value.green')).toHaveText('12')
    await expect(page.locator('.md-not-tracked')).toHaveCount(0)
  })

  test('the canonical encoded URL still works directly', async ({ page }) => {
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
  })

  test('two different hosts stay two different pages', async ({ page }) => {
    await page.goto('/mint/alpha.mint.example')
    await expect(page.getByText('Alpha Mint').first()).toBeVisible()
    const alphaUrl = page.url()

    await page.goto('/mint/bravo.mint.example')
    await expect(page.getByText('Bravo Mint').first()).toBeVisible()
    expect(page.url()).not.toBe(alphaUrl)
  })

  test('an onion mint URL is prefixed with a "Tor" label (not hidden, not merged)', async ({ page }) => {
    const { MOCK_KNOWN_MINTS } = await import('./fixtures/mocks')
    const onionUrl = 'https://mintxyzabc234onionaddress0000000000000000000000000000000.onion'
    await page.route('**/api/mints/known', r => r.fulfill({
      json: [...MOCK_KNOWN_MINTS, { ...MOCK_KNOWN_MINTS[0], url: onionUrl, name: 'Onion Mint', online: true }],
    }))
    await page.goto(`/mint/${encodeURIComponent(onionUrl)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()

    const urlBtn = page.locator('button.md-url-copy')
    await expect(urlBtn.locator('.md-url-tor')).toHaveText('Tor')
    await expect(urlBtn).toContainText(onionUrl) // the full onion URL is still shown
  })

  test('an unknown host shows the "Not a tracked mint" state, not a 3% ghost', async ({ page }) => {
    await page.goto('/mint/definitely-not-a-real-mint.example')
    await expect(page.locator('.md-not-tracked')).toBeVisible()
    await expect(page.getByText('Not a tracked mint')).toBeVisible()
    // No fake full detail: no tabs, no Trust gauge/score.
    await expect(page.locator('.md-tabs')).toHaveCount(0)
    await expect(page.locator('.md-sc-trust-num')).toHaveCount(0)
    await expect(page.locator('.gauge-num')).toHaveCount(0)
  })
})
