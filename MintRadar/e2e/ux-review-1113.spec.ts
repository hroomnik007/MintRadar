import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// External UI/UX review of 2026-11-11, the fixes of 2026-11-13: a visible page heading on the mint list, the NIP-87 line
// in "Mint info" instead of the header, a way to a review for a logged-out visitor, and "Add a mint" on the
// "Not a tracked mint" state.

const ALPHA = encodeURIComponent(MOCK_MINTS[0]!.url)

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

for (const width of [390, 1440]) {
  test(`mint list at ${width}px: a visible h1 and one sentence that says what the page is for`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const h1 = page.getByTestId('dashboard-heading')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Cashu mints')
    const box = await h1.boundingBox()
    expect(box!.height).toBeGreaterThan(20) // not the 1px visually hidden heading it used to be
    const desc = page.locator('.page-head-desc')
    await expect(desc).toContainText('before you trust it with sats')
    // The link in the sentence is underlined (not told apart by colour alone) and goes to the first Learn module.
    const link = desc.getByRole('link', { name: 'Start with the basics' })
    expect(await link.evaluate(e => getComputedStyle(e).textDecorationLine)).toContain('underline')
    await link.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/learn/cashu-basics')
  })
}

test('the main menu names the mint list "Mints"', async ({ page }) => {
  await page.goto('/stats')
  await page.locator('.navbar-tabs').getByRole('link', { name: 'Mints', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
})

test('Mint Detail: the NIP-87 line is a row of "Mint info", not a line of the header', async ({ page }) => {
  await page.goto(`/mint/${ALPHA}`)
  const row = page.locator('.md-info-list').getByTestId('md-nip87')
  await expect(row).toBeVisible()
  await expect(page.locator('.md-header').getByTestId('md-nip87')).toHaveCount(0)
})

test('Reviews tab, logged out: "Log in to write a review" opens the login dialog', async ({ page }) => {
  await page.goto(`/mint/${ALPHA}`)
  await page.getByRole('tab', { name: /Reviews/ }).click()
  await page.getByTestId('reviews-login-btn').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText(/Nostr/)
})

test('"Not a tracked mint": no empty header card, and "Add a mint" opens the dialog on the mint list', async ({ page }) => {
  await page.goto(`/mint/${encodeURIComponent('https://nope.example')}`)
  await expect(page.getByRole('heading', { name: 'Not a tracked mint' })).toBeVisible()
  const header = page.locator('.md-header')
  expect(await header.evaluate(e => { const cs = getComputedStyle(e); return cs.borderTopWidth + ' ' + cs.backgroundColor })).toBe('0px rgba(0, 0, 0, 0)')
  await page.getByTestId('not-tracked-add').click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/')
  await expect(page.locator('#submit-input')).toBeVisible()
})
