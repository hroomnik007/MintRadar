import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Mint Detail sets its own <link rel="canonical"> and og:url (useDocumentMeta `canonicalPath`) so a
// rendered /mint/<url> page does not carry index.html's homepage canonical. og:title, og:image and the
// rest keep the static values; the homepage values come back when the page is left.

const ALPHA = MOCK_MINTS[0]!.url
const HOME_CANONICAL = 'https://mintradar.org/'
const canonical = (page: Page) => page.locator('link[rel="canonical"]').getAttribute('href')
const ogUrl = (page: Page) => page.locator('meta[property="og:url"]').getAttribute('content')

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test('a mint page has its own canonical and og:url; the homepage values return after navigating back', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('a.card-link').first()).toBeVisible()
  expect(await canonical(page)).toBe(HOME_CANONICAL)

  await page.locator('a.card-link').first().click()
  await expect(page).toHaveURL(/\/mint\//)
  const self = `https://mintradar.org${new URL(page.url()).pathname}`
  await expect.poll(() => canonical(page)).toBe(self)
  expect(self).toBe(`https://mintradar.org/mint/${encodeURIComponent(ALPHA)}`)
  expect(await ogUrl(page)).toBe(self)
  // The rest of the head is untouched: the generic og:title and og:image stay.
  expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toBe('https://mintradar.org/og-image-reliability.png')
  expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toContain('MintRadar')

  await page.goBack()
  await expect(page).not.toHaveURL(/\/mint\//)
  await expect.poll(() => canonical(page)).toBe(HOME_CANONICAL)
  expect(await ogUrl(page)).toBe('https://mintradar.org')
})

test('a direct visit to a mint page renders its own canonical', async ({ page }) => {
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect.poll(() => canonical(page)).toBe(`https://mintradar.org/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
})

test('a hostile mint URL is encoded in the canonical and injects no tag', async ({ page }) => {
  const hostile = 'https://evil.example/"><script>window.__pwned=1</script><link rel="canonical" href="https://evil.example/">'
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, url: hostile } : m))
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  await page.goto(`/mint/${encodeURIComponent(hostile)}`)
  const expected = `https://mintradar.org/mint/${encodeURIComponent(hostile)}`
  await expect.poll(() => canonical(page)).toBe(expected)
  expect(expected).not.toMatch(/[<>"' ]/)
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined()
})
