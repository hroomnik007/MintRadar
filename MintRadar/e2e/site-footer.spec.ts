import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Site footer', () => {
  test('renders the copyright/open-source and API links on desktop, left-aligned row', async ({ page }) => {
    await page.goto('/')

    const footer = page.locator('footer.app-footer')
    await expect(footer).toBeVisible()

    // 2026-09-22 (commit b0f8710) deliberately dropped the "Nostr DM for vuln reports" and
    // "Learn" footer links (vuln reporting moved to SECURITY.md; Learn wasn't pulling its
    // weight in the footer) and fixed the API link, which was 404ing for missing the
    // MintRadar/ path prefix — kept as-is. 2026-09-23 folded the separate copyright line
    // into this same link ("MintRadar.org" -> "© 2026 MintRadar.org", still pointing at the
    // repo) instead of adding a third row; the desktop layout itself stays the original
    // left-aligned space-between row (a same-day centered-column redesign was mobile-only
    // and reverted on desktop).
    await expect(footer.getByRole('link', { name: '© 2026 MintRadar.org' })).toHaveAttribute(
      'href',
      'https://github.com/hroomnik007/MintRadar',
    )
    await expect(footer.getByRole('link', { name: 'API' })).toHaveAttribute(
      'href',
      'https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md',
    )

    await expect(footer.getByText('Reliability is a health signal, not solvency.')).toBeVisible()
    await expect(footer.getByText('Powered by Cashu and NIP-87')).toBeVisible()
  })

  // 2026-09-23: mobile-only centering + continuous-text pass. Row 1 (links) is centered;
  // row 2 flows as one continuous sentence with a visible "·" separator (not stacked into
  // two independently-aligned lines — an earlier same-day fix for the "orphaned ·" bug had
  // stacked + hidden it, this supersedes that for the note row's own layout while keeping
  // the underlying fix: .app-footer-note no longer behaves as a flex row on mobile, so a
  // wrapped first sentence can no longer strand the dot + second sentence beside it).
  test.describe('mobile viewport', () => {
    for (const width of [375, 390, 414]) {
      test(`row 1 centered, row 2 flows as continuous text at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 })
        await page.goto('/')

        const footer = page.locator('footer.app-footer')
        await expect(footer).toBeVisible()

        // Row 1 — both links visible, in-viewport, and centered as a group.
        const linksRow = footer.locator('.app-footer-links')
        const mintradarLink = footer.getByRole('link', { name: '© 2026 MintRadar.org' })
        const apiLink = footer.getByRole('link', { name: 'API' })
        await expect(mintradarLink).toBeVisible()
        await expect(apiLink).toBeVisible()
        for (const link of [mintradarLink, apiLink]) {
          const box = await link.boundingBox()
          expect(box).not.toBeNull()
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        }
        const linksBox = await linksRow.boundingBox()
        expect(linksBox).not.toBeNull()
        const linksCenter = linksBox!.x + linksBox!.width / 2
        expect(Math.abs(linksCenter - width / 2)).toBeLessThan(4)

        // Row 2 — both sentences visible, and the "·" separator renders (with enough
        // spacing to actually be legible, not a 2px glyph flush against the words).
        const note = footer.locator('.app-footer-note')
        await expect(note).toHaveText('Reliability is a health signal, not solvency.·Powered by Cashu and NIP-87')
        const dot = footer.locator('.app-footer-dot')
        await expect(dot).toBeVisible()
        // The dot glyph itself is only ~2px wide — assert it has real margin around it
        // instead (a 2026-09-23 fix), so it reads as a separator rather than sitting
        // flush against "solvency." and "Powered".
        const dotMargin = await dot.evaluate((el) => {
          const cs = getComputedStyle(el)
          return parseFloat(cs.marginLeft) + parseFloat(cs.marginRight)
        })
        expect(dotMargin).toBeGreaterThan(4)
      })
    }
  })

  test('is present on other routes too (not a Dashboard-only element)', async ({ page }) => {
    await page.goto('/watchlist')
    await expect(page.locator('footer.app-footer')).toBeVisible()
  })
})
