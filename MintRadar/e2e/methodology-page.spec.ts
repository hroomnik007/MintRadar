import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import {
  DOC_WIDTHS, recordHosts, expectNoHorizontalOverflow, expectBoxesInsideViewport, expectLinksValid,
  expectExternalLinksSafe, expectKeyboardOrder,
} from './fixtures/docPage'
import { METHODOLOGY_CHANGES, METHODOLOGY_VERSION } from '../src/utils/methodology'
import { PAGE_META } from '../src/utils/pageMeta'

// /methodology: the Reliability Score reference (pages/Methodology.tsx, numbers in constants/methodologyPage.ts).

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

test.describe('Methodology page', () => {
  test('renders one h1 and its sections', async ({ page }) => {
    await page.goto('/methodology')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: 'How the Reliability Score is computed' })).toBeVisible()
    for (const name of [
      'What the score is, and what it is not', 'The five components', 'Caps and gates', 'Reviews are separate',
      'Data sources and cadence', 'What is not measured', 'Change log', 'Report an error',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible()
    }
    for (const name of ['Uptime (40 points)', 'Audit reliability (25 points)', 'NUT support (15 points)', 'Software version (15 points)', 'Contact (5 points)']) {
      await expect(page.getByRole('heading', { level: 3, name })).toBeVisible()
    }
    await expect(page.getByTestId('methodology-version')).toContainText(`Methodology version ${METHODOLOGY_VERSION}`)
  })

  test('title, description, canonical and Open Graph tags', async ({ page }) => {
    await page.goto('/')
    const genericImage = await page.locator('meta[property="og:image"]').getAttribute('content')
    await page.goto('/methodology')
    await expect(page).toHaveTitle(PAGE_META['/methodology'].title)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://mintradar.org/methodology')
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://mintradar.org/methodology')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', PAGE_META['/methodology'].title)
    const description = await page.locator('meta[name="description"]').getAttribute('content')
    expect(description).toBe(PAGE_META['/methodology'].description)
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', genericImage!)
  })

  for (const width of DOC_WIDTHS) {
    test(`no horizontal overflow at ${width}px; tables scroll inside their box`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/methodology')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoHorizontalOverflow(page, `methodology ${width}px`)
      await expectBoxesInsideViewport(page, '.doc-table-wrap', width)
    })
  }

  test('the change log shows the newest entry first and matches METHODOLOGY_CHANGES', async ({ page }) => {
    await page.goto('/methodology')
    const expected = [...METHODOLOGY_CHANGES].sort((a, b) => b.version - a.version)
    const items = page.locator('.doc-changelog li')
    await expect(items).toHaveCount(expected.length)
    for (const [i, c] of expected.entries()) {
      await expect(items.nth(i)).toContainText(`Methodology ${c.version}`)
      await expect(items.nth(i)).toContainText(c.date)
      await expect(items.nth(i)).toContainText(c.summary)
    }
    await expect(items.first()).toContainText(`Methodology ${METHODOLOGY_VERSION}`)
  })

  test('internal links are valid and external links are safe', async ({ page }) => {
    await page.goto('/methodology')
    await expectLinksValid(page)
    await expectExternalLinksSafe(page)
    await expect(page.locator('main a[target="_blank"]').first()).toBeAttached()
  })

  test('contact card repeats the About page contact (npub, NIP-05, no e-mail)', async ({ page }) => {
    await page.goto('/about')
    const aboutCard = await page.locator('#contact').innerText()
    await page.goto('/methodology')
    const card = page.getByRole('group', { name: 'Contact' })
    for (const needle of ['npub1zatej55x47xzhnw06yarqr5ugz7y5el8vygcckek24e5qmrtx77qnmd6rg', 'wildcitizen7@mintradar.org']) {
      expect(aboutCard).toContain(needle)
      await expect(card).toContainText(needle)
    }
    await expect(page.locator('main a[href^="mailto:"]')).toHaveCount(0)
  })

  test('makes no request to any host other than the app', async ({ page }) => {
    const rec = recordHosts(page)
    await page.goto('/methodology')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(rec.hosts()).toEqual(['localhost:5173'])
  })

  test('keyboard: Tab reaches every control in order with a visible focus indicator', async ({ page }) => {
    await page.goto('/methodology')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectKeyboardOrder(page)
  })

  test('the Learn module links here', async ({ page }) => {
    await page.goto('/learn/how-to-choose-a-mint')
    await page.getByRole('link', { name: 'Reliability Score methodology' }).click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/methodology')
    await expect(page.getByRole('heading', { level: 1, name: 'How the Reliability Score is computed' })).toBeVisible()
  })

  test('the score breakdown modal has one "How the score is computed" link, and it opens this page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`)
    await page.locator('.md-sc.md-sc-reliability').click()
    const dialog = page.getByRole('dialog', { name: 'Reliability Score Breakdown' })
    await expect(dialog).toBeVisible()
    const link = dialog.getByRole('link', { name: 'How the score is computed' })
    await expect(link).toHaveCount(1)
    await expect(link).toHaveAttribute('href', '/methodology')
    await link.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/methodology')
    await expect(page.getByRole('heading', { level: 1, name: 'How the Reliability Score is computed' })).toBeVisible()
  })
})
