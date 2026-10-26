import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

const ALPHA = 'https://alpha.mint.example'

const KS = [
  { id: '00ad268c4d1f5826', unit: 'sat', active: true, input_fee_ppk: 100 },
  { id: '00c074b96c7e2b0e', unit: 'sat', active: false, input_fee_ppk: 0 },
  { id: '00ffee11aa22bb33', unit: 'usd', active: true, input_fee_ppk: 250 },
]

function probeWith(keysets: unknown, online = true) {
  return {
    url: ALPHA, online, latencyMs: online ? 40 : null,
    info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts: { '4': {}, '5': {} } },
    keysets,
    checkedAt: new Date().toISOString(),
  }
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Mint Detail — Keysets panel placement (desktop)', () => {
  test('renders on Overview and NOT on the NUTs tab', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()

    const overviewPanel = page.locator('.md-keysets-at-overview')
    await expect(overviewPanel).toBeVisible()
    await expect(overviewPanel.locator('.md-panel-title', { hasText: 'Keysets' })).toBeVisible()
    // Two of the three keysets are active: those two show, the inactive one is folded behind the button.
    await expect(overviewPanel.locator('.md-keyset-row')).toHaveCount(2)
    await overviewPanel.getByRole('button', { name: 'Show 1 inactive keyset' }).click()
    await expect(overviewPanel.locator('.md-keyset-row')).toHaveCount(3)
    await expect(overviewPanel.getByText('100 ppk')).toBeVisible()
    await expect(overviewPanel.getByText('free')).toBeVisible()
    await expect(overviewPanel.getByText('250 ppk')).toBeVisible()
    // Each row shows id / unit / Active-Inactive only — the panel does not
    // render a per-input fee ("N ppk"/"free") value.
    await expect(overviewPanel.getByText('sat', { exact: true })).toHaveCount(2)
    await expect(overviewPanel.getByText('usd', { exact: true })).toHaveCount(1)
    await expect(page.locator('.md-keysets-at-nuts')).toBeHidden()

    await page.locator('.md-tab', { hasText: 'NUTs' }).click()
    await expect(page.locator('.md-keysets-at-nuts')).toBeHidden()
  })

  test('the keyset explanation is visible text under the heading, not a tooltip', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    const panel = page.locator('.md-keysets-at-overview')
    await expect(panel.locator('.md-panel-title', { hasText: 'Keysets' })).toBeVisible()
    await expect(panel.locator('.md-panel-hint')).toHaveText('Signing keys per unit. Active keys sign new tokens; tokens from old keys can still be spent.')
    await expect(panel.locator('.md-panel-title [data-tooltip-trigger]')).toHaveCount(0)
  })

  test('lists active / inactive state and copies the full id', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)

    const panel = page.locator('.md-keysets-at-overview')
    await expect(panel.getByText('00ad268c…4d1f5826')).toBeVisible()
    await panel.getByRole('button', { name: 'Show 1 inactive keyset' }).click()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(2)
    await expect(panel.getByText('Inactive', { exact: true })).toHaveCount(1)

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await panel.locator('.md-keyset-row').first().getByRole('button', { name: 'Copy full keyset ID' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('00ad268c4d1f5826')
  })

  test('empty state unchanged when the probe returns no keysets', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(null, false) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)

    const panel = page.locator('.md-keysets-at-overview')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Keyset data not available.')).toBeVisible()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(0)
  })
})

test.describe('Mint Detail — Keysets panel placement (mobile)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  async function openNutsTab(page: import('@playwright/test').Page) {
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await page.locator('.md-tab', { hasText: 'NUTs' }).click()
  }

  test('renders on the NUTs tab and NOT on Overview', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await expect(page.locator('.md-keysets-at-overview')).toBeHidden()
    await page.locator('.md-tab', { hasText: 'NUTs' }).click()
    const panel = page.locator('.md-keysets-at-nuts')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.md-panel-title', { hasText: 'Keysets' })).toBeVisible()
    await expect(panel.locator('.md-keyset-row')).toHaveCount(2)
    await panel.getByRole('button', { name: 'Show 1 inactive keyset' }).click()
    await expect(panel.locator('.md-keyset-row')).toHaveCount(3)
  })

  test('visible hint under the heading + active/inactive badges + copy still work', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await openNutsTab(page)
    const panel = page.locator('.md-keysets-at-nuts')
    await expect(panel.locator('.md-panel-hint')).toHaveText(/tokens from old keys can still be spent/)
    await panel.getByRole('button', { name: 'Show 1 inactive keyset' }).click()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(2)
    await expect(panel.getByText('Inactive', { exact: true })).toHaveCount(1)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await panel.locator('.md-keyset-row').first().getByRole('button', { name: 'Copy full keyset ID' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('00ad268c4d1f5826')
  })

  test('empty state unchanged when the probe returns no keysets', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(null, false) }))
    await openNutsTab(page)
    const panel = page.locator('.md-keysets-at-nuts')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Keyset data not available.')).toBeVisible()
    await expect(panel.getByText('Active', { exact: true })).toHaveCount(0)
  })
})

test.describe('Mint Detail — Keysets order (active first)', () => {
  // The inactive ids sort BEFORE the active one, so only an explicit sort puts the active keyset first.
  const MIXED = [
    { id: '0050aaaa11112222', unit: 'sat', active: false, input_fee_ppk: 0 },
    { id: '00b4bbbb33334444', unit: 'sat', active: false, input_fee_ppk: 0 },
    { id: '006bcccc55556666', unit: 'sat', active: false, input_fee_ppk: 0 },
    { id: '01ba0000deadbeef', unit: 'sat', active: true, input_fee_ppk: 100 },
  ]
  const ORDER = ['01ba0000…deadbeef', '0050aaaa…11112222', '00b4bbbb…33334444', '006bcccc…55556666']

  test('both copies list the active keyset first, inactive ones keep their relative order', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(MIXED) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    // The desktop copy lives in the Overview sidebar, the mobile copy on the NUTs tab (one is CSS-hidden per breakpoint): read the text, not the visibility.
    for (const copy of ['.md-keysets-at-overview', '.md-keysets-at-nuts']) {
      if (copy === '.md-keysets-at-nuts') await page.locator('.md-tab', { hasText: 'NUTs' }).click()
      const rows = page.locator(`${copy} .md-keyset-row`)
      // The fold state belongs to the page (one state for both copies): the first copy starts folded, the second one is already expanded.
      if (copy === '.md-keysets-at-overview') {
        await expect(rows).toHaveCount(1)
        await page.locator(copy).getByRole('button', { name: 'Show 3 inactive keysets' }).click()
      }
      await expect(rows).toHaveCount(4)
      const ids = (await rows.allTextContents()).map(t => /[0-9a-f]{8}…[0-9a-f]{8}/.exec(t)?.[0])
      expect(ids, copy).toEqual(ORDER)
      await expect(rows.first()).toContainText('Active')
      await expect(rows.nth(1)).toContainText('Inactive')
    }
  })
})

test.describe('Mint Detail — Keysets fold (inactive keysets)', () => {
  // Task Z2: only the active keysets show by default; the inactive ones sit behind a text button.
  const FOUR = [
    { id: '01ba0000deadbeef', unit: 'sat', active: true, input_fee_ppk: 100 },
    { id: '0050aaaa11112222', unit: 'sat', active: false, input_fee_ppk: 0 },
    { id: '00b4bbbb33334444', unit: 'sat', active: false, input_fee_ppk: 0 },
    { id: '006bcccc55556666', unit: 'sat', active: false, input_fee_ppk: 0 },
  ]
  const ONE = [FOUR[0]!]
  const NONE_ACTIVE = FOUR.slice(1)

  for (const [label, viewport, copy] of [
    ['desktop', { width: 1440, height: 900 }, '.md-keysets-at-overview'],
    ['phone', { width: 390, height: 844 }, '.md-keysets-at-nuts'],
  ] as const) {
    test.describe(label, () => {
      test.use({ viewport })

      async function open(page: import('@playwright/test').Page, keysets: unknown) {
        await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(keysets) }))
        await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
        await expect(page.locator('.md-tabs')).toBeVisible()
        if (label === 'phone') await page.locator('.md-tab', { hasText: 'NUTs' }).click()
        const panel = page.locator(copy)
        await expect(panel.locator('.md-panel-title', { hasText: 'Keysets' })).toBeVisible()
        return panel
      }

      test('4 keysets, 1 active: one row by default, the button expands to all four and back', async ({ page }) => {
        const panel = await open(page, FOUR)
        const rows = panel.locator('.md-keyset-row')
        await expect(rows).toHaveCount(1)
        await expect(rows.first()).toContainText('Active')
        const toggle = panel.getByRole('button', { name: /inactive keysets?$|Show fewer/ })
        await expect(toggle).toHaveText('Show 3 inactive keysets')
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await toggle.click()
        await expect(rows).toHaveCount(4)
        await expect(toggle).toHaveText('Show fewer')
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await toggle.click()
        await expect(rows).toHaveCount(1)
        await expect(toggle).toHaveText('Show 3 inactive keysets')
      })

      test('1 keyset: shown, no button', async ({ page }) => {
        const panel = await open(page, ONE)
        await expect(panel.locator('.md-keyset-row')).toHaveCount(1)
        await expect(panel.locator('.md-keysets-toggle')).toHaveCount(0)
      })

      test('no active keyset: all rows shown, no button', async ({ page }) => {
        const panel = await open(page, NONE_ACTIVE)
        await expect(panel.locator('.md-keyset-row')).toHaveCount(3)
        await expect(panel.locator('.md-keysets-toggle')).toHaveCount(0)
      })
    })
  }

  test.describe('phone touch target and text size', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('the button is at least 44 px tall with text of 12 px or more', async ({ page }) => {
      await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(FOUR) }))
      await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
      await page.locator('.md-tab', { hasText: 'NUTs' }).click()
      const toggle = page.locator('.md-keysets-at-nuts .md-keysets-toggle')
      await expect(toggle).toBeVisible()
      const box = (await toggle.boundingBox())!
      expect(box.height).toBeGreaterThanOrEqual(44)
      expect(await toggle.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(12)
    })
  })

})

test.describe('Mint Detail — Keyset final expiry', () => {
  const DAY_S = 86_400
  const nowS = () => Math.floor(Date.now() / 1000)

  test('shown only when the mint sets it; amber under 30 days and once past', async ({ page }) => {
    const ks = [
      { id: '00aa000000000001', unit: 'sat', active: true, input_fee_ppk: 0, final_expiry: nowS() + 10 * DAY_S },
      { id: '00aa000000000002', unit: 'sat', active: true, input_fee_ppk: 0, final_expiry: nowS() + 180 * DAY_S },
      { id: '00aa000000000003', unit: 'usd', active: true, input_fee_ppk: 0 },
      { id: '00aa000000000004', unit: 'sat', active: true, input_fee_ppk: 0, final_expiry: null },
      { id: '00aa000000000005', unit: 'sat', active: false, input_fee_ppk: 0, final_expiry: nowS() - 3 * DAY_S },
    ]
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(ks) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    const panel = page.locator('.md-keysets-at-overview')
    await panel.getByRole('button', { name: 'Show 1 inactive keyset' }).click()
    const rows = panel.locator('.md-keyset-row')
    await expect(rows).toHaveCount(5)

    const soon = rows.nth(0).getByTestId('keyset-expiry')
    await expect(soon).toHaveText(/^Expires \d{1,2} [A-Z][a-z]{2} \d{4}$/)
    await expect(soon).toHaveClass(/md-keyset-expiry--soon/)
    await expect(soon).toHaveAttribute('title', /\(your time\) · .* UTC$/)
    // the amber token (--amber: #d3a446), not the muted date colour
    await expect(soon).toHaveCSS('color', 'rgb(211, 164, 70)')

    const later = rows.nth(1).getByTestId('keyset-expiry')
    await expect(later).toHaveText(/^Expires /)
    await expect(later).not.toHaveClass(/md-keyset-expiry--soon/)
    const muted = await rows.nth(1).locator('.md-chg-date').first().evaluate(e => getComputedStyle(e).color)
    expect(await later.evaluate(e => getComputedStyle(e).color)).toBe(muted)

    await expect(rows.nth(2).getByTestId('keyset-expiry')).toHaveCount(0)
    await expect(rows.nth(3).getByTestId('keyset-expiry')).toHaveCount(0)

    const past = rows.nth(4).getByTestId('keyset-expiry')
    await expect(past).toHaveText(/^Expired /)
    await expect(past).toHaveClass(/md-keyset-expiry--soon/)
    await expect(past).toHaveCSS('color', 'rgb(211, 164, 70)')
  })

  test('a mint without any expiry renders no expiry line and no dates line', async ({ page }) => {
    await page.route('**/api/mint/probe**', route => route.fulfill({ json: probeWith(KS) }))
    await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
    const panel = page.locator('.md-keysets-at-overview')
    await expect(panel.locator('.md-keyset-row')).toHaveCount(2)
    await expect(panel.getByTestId('keyset-expiry')).toHaveCount(0)
  })
})
