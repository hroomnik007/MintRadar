import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, loginAs } from './fixtures/mocks'

// Bug: on a card for an offline mint with no latency value (latency shows "—"),
// the action buttons used to float up because the card was shorter than its
// grid neighbours. The action row must now be pinned to the bottom edge of
// every card — `card.bottom - actions.bottom` is a constant (the card padding)
// no matter how much content sits above it.
test('card action row stays pinned to the bottom regardless of latency presence', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await loginAs(page)
  await page.goto('/')
  await expect(page.locator('.mint-card')).toHaveCount(4)
  // Logged in → every card (incl. offline Charlie) shows a Watch button.
  await expect(page.getByRole('button', { name: 'Watch', exact: true })).toHaveCount(4)

  const gaps = await page.evaluate(() =>
    [...document.querySelectorAll('.mint-grid .mint-card')].map(card => {
      const actions = card.querySelector('.card-actions') as HTMLElement
      const cr = card.getBoundingClientRect()
      const ar = actions.getBoundingClientRect()
      return Math.round(cr.bottom - ar.bottom)
    })
  )

  // Every card — Charlie (offline, latency "—") included — has the same
  // bottom gap between the card edge and the action buttons.
  expect(Math.max(...gaps) - Math.min(...gaps), JSON.stringify(gaps)).toBeLessThanOrEqual(1)
})
