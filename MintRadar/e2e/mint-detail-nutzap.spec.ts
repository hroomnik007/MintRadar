import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

type Page = import('@playwright/test').Page

// The "Nutzap-related features" Overview panel is gone. What is left: one muted sentence under the NUT compatibility grid on
// the NUTs tab (no verdict, no "ready"), and the NUT card grid that follows `supported:false` / presence-only / absent entries.

const ALPHA = 'https://alpha.mint.example'
const SENTENCE = 'NUT-07, NUT-10, NUT-11 and NUT-12 are the ones nutzaps (NIP-61) rely on.'
const note = (page: Page) => page.locator('.md-nut-nutzap-note')

async function open(page: Page, nuts: Record<string, unknown>, size: [number, number] = [1440, 900], tab: 'nuts' | 'overview' = 'nuts', knownOver: Record<string, unknown> = {}) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  const fetchedAt = new Date(Date.now() - 5 * 60_000).toISOString()
  const rows = MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, lastCheckedAt: fetchedAt, nutsLimits: nuts, ...knownOver } : m))
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
  await page.route('**/api/mint/probe**', r => r.fulfill({ json: {
    url: ALPHA, online: true, latencyMs: 40,
    info: { name: 'Alpha Mint', version: 'Nutshell/0.16.0', nuts },
    keysets: null, checkedAt: fetchedAt,
  } }))
  await resize(page, size[0], size[1])
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  if (tab === 'nuts') await page.locator('.md-tab', { hasText: /^NUTs/ }).click()
}

test('the Overview has no Nutzap-related features panel', async ({ page }) => {
  await open(page, { '4': {}, '5': {}, '7': {}, '11': {} }, [1440, 900], 'overview')
  await expect(page.getByText('Mint info', { exact: true })).toBeVisible()
  await expect(page.getByTestId('mint-nutzap')).toHaveCount(0)
  await expect(page.getByText('Nutzap-related features')).toHaveCount(0)
  await expect(note(page)).toHaveCount(0)
})

test('the NUTs tab has the one muted sentence under the NUT compatibility grid, with no verdict', async ({ page }) => {
  await open(page, { '4': {}, '5': {}, '7': {}, '10': {}, '11': {}, '12': {} })
  await expect(note(page)).toHaveText(SENTENCE)
  await expect(page.locator('.nut-grid + .md-nut-nutzap-note')).toHaveCount(1)
  await expect(page.locator('.md-panel', { has: page.locator('.nut-grid') })).toContainText(SENTENCE)
  await expect(note(page)).not.toContainText(/ready|safe|recommended|trusted|supported/i)
  // the same sentence whatever the mint declares
  await expect(page.getByText(SENTENCE)).toHaveCount(1)
})

test('the sentence is the same for a mint that declares none of the four NUTs', async ({ page }) => {
  await open(page, { '4': {}, '5': {} })
  await expect(note(page)).toHaveText(SENTENCE)
})

for (const w of [320, 390, 768, 1440] as const) {
  test(`${w}px: the sentence wraps inside the page, no text under 12 px`, async ({ page }) => {
    await open(page, { '7': {}, '11': {} }, [w, 900])
    await layoutReady(page)
    const m = await note(page).evaluate(el => {
      const vw = document.documentElement.clientWidth
      const r = el.getBoundingClientRect()
      return { right: r.right, left: r.left, vw, scroll: document.documentElement.scrollWidth - vw, px: parseFloat(getComputedStyle(el).fontSize) }
    })
    expect(m.right).toBeLessThanOrEqual(m.vw + 0.5)
    expect(m.left).toBeGreaterThanOrEqual(-0.5)
    expect(m.scroll).toBeLessThanOrEqual(1)
    expect(m.px).toBeGreaterThanOrEqual(12)
  })
}

test('the four shapes of a NUT entry: supported:false is not supported in the NUT card grid and the modal', async ({ page }) => {
  // 7: supported:false, 10: supported:true, 11: presence-only object with settings, 12: absent, 14: null (declared as nothing)
  await open(page, { '4': {}, '5': {}, '7': { supported: false }, '10': { supported: true }, '11': { disabled: false, methods: [] }, '14': null })
  const cardOf = (nut: number) => page.locator('.nut-card', { has: page.locator('.nut-name', { hasText: new RegExp(`^NUT-${String(nut).padStart(2, '0')}$`) }) })
  await expect(cardOf(7)).toHaveClass(/unsupported/)
  await expect(cardOf(7).locator('.nut-check')).toHaveText('–')
  await expect(cardOf(10)).toHaveClass(/\bsupported\b/)
  await expect(cardOf(10).locator('.nut-check')).toHaveText('✓')
  await expect(cardOf(11)).toHaveClass(/\bsupported\b/)
  await expect(cardOf(12)).toHaveClass(/unsupported/)
  await expect(cardOf(14)).toHaveClass(/unsupported/)
  await expect(cardOf(14).locator('.nut-check')).toHaveText('–')
  // The summary line counts the same cards: 4, 5, 10, 11.
  await expect(page.locator('.nut-summary-line strong')).toHaveText('4')
  // The modal agrees with the card.
  await cardOf(7).click()
  await expect(page.locator('.nm-status')).toHaveText('– Not supported')
})

test('a mint without a stored score: the fallback score and the NUT row count `supported:false` and null as not supported', async ({ page }) => {
  // Same mint twice: A declares NUT-04/05/10; B declares the same plus NUT-07 `supported:false` and NUT-14 null. The backend rule
  // (utils/nutSupport.ts, methodology 4) counts 3 NUTs for both; counting keys would make B 5 NUTs and raise its NUT points.
  const noStored = { reliabilityScore: null }
  const read = async () => {
    const panel = page.locator('.md-reliability-panel')
    await expect(panel.locator('.gauge-num')).toBeVisible()
    // Without a stored score the page shows "—" until the 24 h history has arrived and only then the computed score (Task F3):
    // wait for the number, then read it.
    await expect(panel.locator('.gauge-num')).toHaveText(/^\d+$/)
    return {
      score: (await panel.locator('.gauge-num').innerText()).trim(),
      nutRow: (await panel.locator('.rb-row', { hasText: 'NUT Support' }).innerText()).replace(/\s+/g, ' '),
    }
  }
  await open(page, { '4': {}, '5': {}, '10': { supported: true } }, [1440, 900], 'overview', noStored)
  const a = await read()
  expect(a.nutRow).toContain('3 / 14 NUTs')

  const b = await page.context().newPage()
  await open(b, { '4': {}, '5': {}, '10': { supported: true }, '7': { supported: false }, '14': null }, [1440, 900], 'overview', noStored)
  const panel = b.locator('.md-reliability-panel')
  await expect(panel.locator('.gauge-num')).toBeVisible()
  await expect(panel.locator('.gauge-num')).toHaveText(a.score)
  expect((await panel.locator('.rb-row', { hasText: 'NUT Support' }).innerText()).replace(/\s+/g, ' ')).toContain('3 / 14 NUTs')
})
