// Mint Detail NUT modal (N1, 2026-10-28): the "Offered by X of Y online mints." fact line, the renamed
// "What this NUT covers" heading and the two plain facts for a NUT that is not supported.
import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, probePayload } from './fixtures/mocks'


// Fixture: Alpha, Bravo and Delta are online (12, 8 and 14 NUTs), Charlie is offline. NUT-20 is only on Delta.
async function open(page: Page, nut: string) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS }))
  await page.goto('/mint/alpha.mint.example')
  await page.locator('.md-tab', { hasText: /^NUTs$/ }).click()
  await page.locator('.nut-card', { hasText: nut }).click()
  await expect(page.locator('.nm')).toBeVisible()
}

for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`Mint Detail NUT modal @ ${vp.width}`, () => {
    test.use({ viewport: vp })

    test('says how many online mints offer the NUT, with the Stats modal counting rule', async ({ page }) => {
      await open(page, 'NUT-20')
      await expect(page.locator('.nm .nm-fact', { hasText: 'Offered by' })).toHaveText('Offered by 1 of 3 online mints.')
      await page.keyboard.press('Escape')
      await page.locator('.nut-card', { hasText: 'NUT-09' }).click()
      await expect(page.locator('.nm .nm-fact', { hasText: 'Offered by' })).toHaveText('Offered by 3 of 3 online mints.')
    })

    test('the "Features" heading is now "What this NUT covers"', async ({ page }) => {
      await open(page, 'NUT-09')
      await expect(page.locator('.nm .nm-sec-label', { hasText: 'What this NUT covers' })).toBeVisible()
      await expect(page.locator('.nm .nm-sec-label', { hasText: /^Features$/ })).toHaveCount(0)
      await expect(page.locator('.nm .nm-chip').first()).toBeVisible()
    })

    test('a NUT the mint does not list and one it lists as supported:false read as two different facts', async ({ page }) => {
      await mockRelays(page)
      await installApiMocks(page)
      await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS }))
      // Alpha's live /v1/info: NUT-07 listed with `supported: false`, NUT-20 absent.
      await page.route('**/api/mint/probe**', r => {
        const u = new URL(r.request().url()).searchParams.get('url') ?? ''
        const p = probePayload(u)
        const rest = { ...(p.info.nuts as Record<string, unknown>) }
        delete rest['20']
        r.fulfill({ json: u === 'https://alpha.mint.example' ? { ...p, info: { ...p.info, nuts: { ...rest, '7': { supported: false } } } } : p })
      })
      await page.goto('/mint/alpha.mint.example')
      await page.locator('.md-tab', { hasText: /^NUTs$/ }).click()

      await page.locator('.nut-card', { hasText: 'NUT-07' }).click()
      await expect(page.locator('.nm-status')).toHaveText('– Not supported')
      await expect(page.locator('.nm .nm-fact', { hasText: 'Listed' })).toHaveText('Listed, marked unsupported by this mint')
      await expect(page.locator('.nm').getByText('Not listed by this mint')).toHaveCount(0)
      await page.keyboard.press('Escape')

      await page.locator('.nut-card', { hasText: 'NUT-20' }).click()
      await expect(page.locator('.nm-status')).toHaveText('– Not supported')
      await expect(page.locator('.nm .nm-fact', { hasText: 'Not listed' })).toHaveText('Not listed by this mint')
      await expect(page.locator('.nm').getByText(/Listed, marked unsupported/)).toHaveCount(0)
      await page.keyboard.press('Escape')

      // A supported NUT carries neither fact.
      await page.locator('.nut-card', { hasText: 'NUT-09' }).click()
      await expect(page.locator('.nm-status')).toHaveText('✓ Supported')
      await expect(page.locator('.nm').getByText(/Not listed by this mint|marked unsupported/)).toHaveCount(0)
    })

    test('the line has no link (there is no deep link to the Stats modal) and the number matches the Stats modal', async ({ page }) => {
      await open(page, 'NUT-09')
      await expect(page.locator('.nm .nm-fact', { hasText: 'Offered by' }).locator('a')).toHaveCount(0)
      await page.goto('/stats')
      await page.locator('.stats-nut-row', { hasText: 'NUT-09' }).click()
      await expect(page.locator('.nut-modal-footer')).toContainText('3 of 3 online mints offer this NUT')
    })
  })
}

