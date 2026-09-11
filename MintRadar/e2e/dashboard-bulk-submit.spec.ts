import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// Dashboard "Submit mint" modal → Bulk tab. Covers the rate-limit conflict
// fix between the automatic NIP-87 discovery scan (useNostrDiscovery.ts,
// source: 'auto') and this user-initiated flow (Dashboard.tsx
// handleBulkSubmit, source: 'bulk') — both POST to /api/mints/discover but
// now draw from independent backend budgets (see backend/src/index.ts).
// These tests only exercise the frontend's own handling of a 200 vs a 429
// from that endpoint; the backend's dual-budget logic itself is covered by
// backend/src/__tests__/security/rate-limiting.test.ts and
// backend/src/__tests__/integration/mints-discover.test.ts.

async function openBulkTab(page: import('@playwright/test').Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/')
  await expect(page.locator('.dashboard')).toBeVisible()
  await page.locator('.submit-btn', { hasText: 'Submit mint' }).click()
  await page.locator('.submit-tab-btn', { hasText: 'Bulk' }).click()
}

test('shows the batch size / hourly limit hint', async ({ page }) => {
  await openBulkTab(page)
  await expect(page.getByText('Up to 100 mints per submission, max 10 submissions per hour.')).toBeVisible()
})

test('successful batch: rows resolve to added/duplicate, no rate-limit banner', async ({ page }) => {
  await openBulkTab(page)
  await page.route('**/api/mints/discover', route => route.fulfill({
    json: {
      added: 1,
      total: 2,
      results: [
        { url: 'https://new.mint.example', success: true, isNew: true },
        { url: 'https://alpha.mint.example', success: true, isNew: false },
      ],
    },
  }))

  await page.locator('.bulk-textarea').fill('https://new.mint.example\nhttps://alpha.mint.example')
  await page.locator('.submit-ok-btn', { hasText: 'Submit All' }).click()

  await expect(page.locator('.bulk-row.status-added')).toHaveCount(1)
  await expect(page.locator('.bulk-row.status-duplicate')).toHaveCount(1)
  await expect(page.getByText('1 added, 1 already tracked, 0 failed')).toBeVisible()
  await expect(page.locator('.submit-result.error', { hasText: 'Rate limit' })).toHaveCount(0)
})

test('429 with Retry-After: one banner with the exact wait, rows stay pending (not failed)', async ({ page }) => {
  await openBulkTab(page)
  await page.route('**/api/mints/discover', route => route.fulfill({
    status: 429,
    headers: { 'Retry-After': '120' },
    json: { error: 'Too many requests. Try again later.' },
  }))

  await page.locator('.bulk-textarea').fill('https://one.mint.example\nhttps://two.mint.example')
  await page.locator('.submit-ok-btn', { hasText: 'Submit All' }).click()

  // One clear banner — not the raw backend message repeated per row.
  const banner = page.locator('.submit-result.error', { hasText: 'Rate limit reached' })
  await expect(banner).toHaveCount(1)
  await expect(banner).toHaveText('Rate limit reached — try again in 2 minutes.')

  // Neither row was actually processed — both stay in a neutral "pending"
  // state, not "failed".
  await expect(page.locator('.bulk-row.status-pending')).toHaveCount(2)
  await expect(page.locator('.bulk-row.status-failed')).toHaveCount(0)
  await expect(page.locator('.bulk-row', { hasText: 'Too many requests' })).toHaveCount(0)

  // The numeric "N added / M tracked / K failed" summary is suppressed in
  // favour of the banner — showing "0 added, 0 tracked, 0 failed" here would
  // read as if the batch was processed and simply rejected outright.
  await expect(page.getByText(/added,.*already tracked,.*failed/)).toHaveCount(0)
})

test('429 without Retry-After: falls back to a generic message', async ({ page }) => {
  await openBulkTab(page)
  await page.route('**/api/mints/discover', route => route.fulfill({
    status: 429,
    json: { error: 'Too many requests. Try again later.' },
  }))

  await page.locator('.bulk-textarea').fill('https://one.mint.example')
  await page.locator('.submit-ok-btn', { hasText: 'Submit All' }).click()

  await expect(page.locator('.submit-result.error', { hasText: 'Rate limit reached — try again later.' })).toBeVisible()
  await expect(page.locator('.bulk-row.status-pending')).toHaveCount(1)
})

test('reopening the modal after a 429 clears the banner', async ({ page }) => {
  await openBulkTab(page)
  await page.route('**/api/mints/discover', route => route.fulfill({
    status: 429,
    headers: { 'Retry-After': '60' },
    json: { error: 'Too many requests. Try again later.' },
  }))
  await page.locator('.bulk-textarea').fill('https://one.mint.example')
  await page.locator('.submit-ok-btn', { hasText: 'Submit All' }).click()
  await expect(page.locator('.submit-result.error', { hasText: 'Rate limit reached' })).toBeVisible()

  await page.locator('.submit-ok-btn', { hasText: 'Close' }).click()
  await page.locator('.submit-btn', { hasText: 'Submit mint' }).click()
  await page.locator('.submit-tab-btn', { hasText: 'Bulk' }).click()

  await expect(page.locator('.submit-result.error', { hasText: 'Rate limit reached' })).toHaveCount(0)
  await expect(page.locator('.bulk-textarea')).toBeVisible()
})
