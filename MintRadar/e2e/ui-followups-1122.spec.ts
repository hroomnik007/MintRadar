import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'

// Follow-ups of 2026-11-22 (owner): the status box in two lines, "New to Cashu?" on its own line, the plus ("Add a mint")
// with the copper outline of "Find a mint for me" at every width, no intro sentence on the History tab, and green rings
// for software updates in its timeline.

const ALPHA = MOCK_MINTS[0]!.url
const DAY = 86_400_000

async function home(page: Page, width: number) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/?status=all')
  await expect(page.locator('.mint-card').first()).toBeVisible()
}

for (const width of [1440, 390]) {
  test.describe(`home at ${width}px`, () => {
    test('status box: "N of M mints online", then a smaller, muted "Last check … from …"', async ({ page }) => {
      await home(page, width)
      const main = page.locator('.dash-status-main')
      const sub = page.locator('.dash-status-sub')
      await expect(main).toHaveText('3 of 4 mints online')
      await expect(sub).toHaveText(/^\s*Last check .+ from Nuremberg\s*$/)
      const [m, s] = await Promise.all([main, sub].map(l => l.evaluate(e => {
        const cs = getComputedStyle(e); const r = e.getBoundingClientRect()
        return { size: parseFloat(cs.fontSize), color: cs.color, top: r.top, bottom: r.bottom }
      })))
      expect(s!.size).toBeLessThan(m!.size)
      expect(s!.color).not.toBe(m!.color)
      expect(s!.top).toBeGreaterThanOrEqual(m!.bottom - 1) // its own line, under the count
      await expect(page.locator('.dash-status')).not.toContainText('answered')
    })

    test('"New to Cashu? Start with the basics." starts a new line of the description', async ({ page }) => {
      await home(page, width)
      const desc = page.locator('.page-head-desc')
      await expect(desc).toContainText('How reliably each Cashu mint runs, so you can decide where to keep your sats.')
      const line = desc.locator('.page-head-desc-line')
      await expect(line).toHaveText('New to Cashu? Start with the basics.')
      await expect(line.getByRole('link', { name: 'Start with the basics' })).toHaveAttribute('href', '/learn/cashu-basics')
      const lineBox = (await line.boundingBox())!
      const descBox = (await desc.boundingBox())!
      expect(Math.abs(lineBox.x - descBox.x)).toBeLessThan(1) // starts at the left edge: a line of its own
      expect(lineBox.y).toBeGreaterThan(descBox.y + 4)
    })

    test('the plus has the copper outline of "Find a mint for me" and keeps its name', async ({ page }) => {
      await home(page, width)
      const add = page.getByRole('button', { name: 'Add a mint' })
      await expect(add).toBeVisible()
      const find = page.getByRole('button', { name: 'Find a mint for me' })
      const look = (e: Element) => { const cs = getComputedStyle(e); return { border: cs.borderTopColor, color: cs.color } }
      const [a, f] = await Promise.all([add.evaluate(look), find.evaluate(look)])
      expect(a).toEqual(f)
    })
  })
}

test('History tab: no intro sentence, software updates have a green ring', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/version-history**', r => r.fulfill({ json: {
    history: [
      { version: 'Nutshell/0.16.0', firstSeenAt: new Date(Date.now() - 20 * DAY).toISOString() },
      { version: 'Nutshell/0.16.3', firstSeenAt: new Date(Date.now() - 5 * DAY).toISOString() },
    ],
    latestGlobalVersion: 'Nutshell/0.16.3',
  } }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}#history`)
  await expect(page.locator('.md-hist-bar')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('The figures and the chart cover the period you pick')
  const mark = page.locator('.md-ev-update .md-ev-mark').first()
  await expect(mark).toBeVisible()
  const green = await page.evaluate(() => {
    const probe = document.createElement('i'); probe.style.color = 'var(--green-bright)'; document.body.append(probe)
    const c = getComputedStyle(probe).color; probe.remove(); return c
  })
  expect(await mark.evaluate(e => getComputedStyle(e).borderTopColor)).toBe(green)
})
