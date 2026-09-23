import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Site footer', () => {
  test('renders the open-source and API links on Dashboard', async ({ page }) => {
    await page.goto('/')

    const footer = page.locator('footer.app-footer')
    await expect(footer).toBeVisible()

    // 2026-09-22 (commit b0f8710) deliberately dropped the "Nostr DM for vuln reports" and
    // "Learn" footer links (vuln reporting moved to SECURITY.md; Learn wasn't pulling its
    // weight in the footer) and fixed the API link, which was 404ing for missing the
    // MintRadar/ path prefix. This test tracks that current, intentional 2-link footer —
    // do not re-add assertions for the old 4-link version without confirming the product
    // decision was reversed.
    await expect(footer.getByRole('link', { name: 'MintRadar.org' })).toHaveAttribute(
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

  // Regression test for a 2026-09-23 bug: at <=640px .app-footer-note kept its default flex
  // row direction, so the two note sentences wrapped into two side-by-side columns with the
  // "·" separator stranded alone at the wrap point instead of the sentences stacking.
  test.describe('mobile viewport', () => {
    for (const width of [375, 390, 414]) {
      test(`stacks cleanly at ${width}px with no orphaned separator`, async ({ page }) => {
        await page.setViewportSize({ width, height: 812 })
        await page.goto('/')

        const footer = page.locator('footer.app-footer')
        await expect(footer).toBeVisible()

        // Row 1 — both links visible, none clipped outside the viewport.
        const mintradarLink = footer.getByRole('link', { name: 'MintRadar.org' })
        const apiLink = footer.getByRole('link', { name: 'API' })
        await expect(mintradarLink).toBeVisible()
        await expect(apiLink).toBeVisible()
        for (const link of [mintradarLink, apiLink]) {
          const box = await link.boundingBox()
          expect(box).not.toBeNull()
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        }

        // Row 2 — the two note sentences must stack vertically (second sentence strictly
        // below the first, not beside it), and the "·" separator must not render at all on
        // mobile rather than survive as an orphan.
        const firstNote = footer.getByText('Reliability is a health signal, not solvency.')
        const secondNote = footer.getByText('Powered by Cashu and NIP-87')
        await expect(firstNote).toBeVisible()
        await expect(secondNote).toBeVisible()
        const firstBox = await firstNote.boundingBox()
        const secondBox = await secondNote.boundingBox()
        expect(firstBox).not.toBeNull()
        expect(secondBox).not.toBeNull()
        expect(secondBox!.y).toBeGreaterThanOrEqual(firstBox!.y + firstBox!.height - 1)

        await expect(footer.locator('.app-footer-dot')).toBeHidden()
      })
    }
  })

  test('is present on other routes too (not a Dashboard-only element)', async ({ page }) => {
    await page.goto('/watchlist')
    await expect(page.locator('footer.app-footer')).toBeVisible()
  })
})
