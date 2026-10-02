import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, makeCashuToken, MOCK_MINTS } from './fixtures/mocks'

// Every external link that opens a new tab must carry rel="noopener noreferrer"
// (reverse-tabnabbing + referrer leak, e.g. the Tools redeem links carry a token in the URL).
async function expectSafeBlankLinks(page: Page, label: string) {
  const links = page.locator('a[target="_blank"]')
  const rels = await links.evaluateAll(els => els.map(a => ({ href: (a as HTMLAnchorElement).href, rel: a.getAttribute('rel') ?? '' })))
  expect(rels.length, `${label}: expected at least one target=_blank link`).toBeGreaterThan(0)
  for (const { href, rel } of rels) {
    const tokens = rel.split(/\s+/)
    expect(tokens, `${label}: ${href}`).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  }
}

test.describe('external links rel', () => {
  test.beforeEach(async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
  })

  test('Wallets page', async ({ page }) => {
    await page.goto('/wallets')
    await page.waitForSelector('.wallet-card')
    await expectSafeBlankLinks(page, 'wallets')
  })

  for (const n of [3, 4]) {
    test(`Learn Module ${n}`, async ({ page }) => {
      await page.goto(`/learn/${n}`)
      await expect(page.locator('.learn-content')).toBeVisible()
      await expectSafeBlankLinks(page, `module ${n}`)
    })
  }

  test('Tools with a decoded token (redeem links)', async ({ page }) => {
    await page.goto('/tools')
    await page.locator('.token-input').fill(makeCashuToken(MOCK_MINTS[0]!.url, [21, 8]))
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(page.locator('.token-result-grid')).toBeVisible()
    await expect(page.locator('a.token-action-btn[target="_blank"]').first()).toBeVisible()
    await expectSafeBlankLinks(page, 'tools')
  })

  test('footer', async ({ page }) => {
    await page.goto('/wallets')
    await page.waitForSelector('.wallet-card')
    const footerLinks = page.locator('footer a[target="_blank"]')
    expect(await footerLinks.count()).toBeGreaterThan(0)
    await expectSafeBlankLinks(page, 'footer')
  })

  test('Mint Detail', async ({ page }) => {
    await page.goto('/mint/alpha.mint.example')
    await expect(page.locator('a[target="_blank"]').first()).toBeAttached()
    await expectSafeBlankLinks(page, 'mint detail')
  })
})
