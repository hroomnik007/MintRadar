import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

// Regression: the search input's rounded corners must be visible. It sits
// inside the .dashboard-controls bar (var(--bg2)); if its own fill equals that
// (var(--surface) is byte-equal to --bg2, as shipped briefly in 944f346) the
// only thing drawing the shape is a faint --border hairline and the corners
// read as square. Its fill must contrast with the bar, like .filter-btn /
// .sort-segment beside it, and its radius must be the shared --radius-m token (same as the stat cards).
test('search input is a visibly-bounded rounded control', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.search-input')

  const r = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, '')
    const input = getComputedStyle(document.querySelector('.search-input')!)
    const bar = getComputedStyle(document.querySelector('.dashboard-controls')!)
    const filterBtn = getComputedStyle(document.querySelector('.dashboard-controls .filter-btn')!)
    // .stat-card is only rendered on Stats now; probe the shared radius token directly.
    const probe = document.createElement('div')
    probe.style.borderRadius = 'var(--radius-m)'
    document.body.appendChild(probe)
    const tokenRadius = getComputedStyle(probe).borderTopLeftRadius
    probe.remove()
    return {
      inputBg: norm(input.backgroundColor),
      barBg: norm(bar.backgroundColor),
      filterBtnBg: norm(filterBtn.backgroundColor),
      inputRadius: input.borderTopLeftRadius,
      tokenRadius,
    }
  })

  expect(r.inputBg).not.toBe(r.barBg)          // must contrast with the bar
  expect(r.inputBg).toBe(r.filterBtnBg)         // same fill as its row neighbours
  expect(r.inputRadius).toBe(r.tokenRadius)     // corner radius is the shared --radius-m
})
