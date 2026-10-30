import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

const SLUGS = [
  'cashu-basics',
  'understanding-the-risks',
  'how-to-choose-a-mint',
  'getting-started-with-a-wallet',
  'safe-habits',
]

test('numeric deep links /learn/1 … /learn/5 redirect to the slug', async ({ page }) => {
  for (let i = 1; i <= 5; i++) {
    await page.goto(`/learn/${i}`)
    await expect(page).toHaveURL(new RegExp(`/learn/${SLUGS[i - 1]}$`))
    await expect(page.locator('.learn-content h1')).toBeVisible()
  }
})

test('unknown numeric or unknown slug still shows "Module not found"', async ({ page }) => {
  for (const bad of ['0', '6', '99', 'not-a-real-module']) {
    await page.goto(`/learn/${bad}`)
    await expect(page.getByText('Module not found.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to Learn' })).toBeVisible()
  }
})

test('a middle module footer links "Next:" to the following module', async ({ page }) => {
  await page.goto('/learn/cashu-basics')
  await expect(page.locator('.learn-back-link')).toBeVisible()
  const next = page.locator('.learn-nav-next')
  await expect(next).toContainText('Next:')
  await expect(next).toContainText('Understanding the Risks')
  await next.click()
  await expect(page).toHaveURL(/\/learn\/understanding-the-risks$/)
})

test('the last module footer is "Browse mints" → Dashboard', async ({ page }) => {
  await page.goto('/learn/safe-habits')
  const next = page.locator('.learn-nav-next')
  await expect(next).toContainText('Browse mints')
  await next.click()
  await expect(page).toHaveURL(/\/$/)
})

// Learn article column (L1): 16px body text in a ~780px centred column; phones keep full width minus padding.
// The text pages (/about, /methodology, /for-wallets) have their own rules and must stay as they were.
test.describe('Learn article column', () => {
  test('1440px: paragraphs and list items are at least 16px, the column is 740-820px wide and centred', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const slug of SLUGS) {
      await page.goto(`/learn/${slug}`)
      await expect(page.locator('.learn-content h1')).toBeVisible()
      const m = await page.evaluate(() => {
        const col = document.querySelector('.learn-module')!.getBoundingClientRect()
        const sizes = [...document.querySelectorAll('.learn-content p, .learn-content li')].map(e => parseFloat(getComputedStyle(e).fontSize))
        return { w: col.width, left: col.left, right: window.innerWidth - col.right, min: Math.min(...sizes), n: sizes.length }
      })
      expect(m.n, slug).toBeGreaterThan(3)
      expect(m.min, slug).toBeGreaterThanOrEqual(16)
      expect(m.w, slug).toBeGreaterThanOrEqual(740)
      expect(m.w, slug).toBeLessThanOrEqual(820)
      expect(Math.abs(m.left - m.right), slug).toBeLessThanOrEqual(3)
    }
  })

  for (const w of [390, 320]) {
    test(`${w}px: no horizontal overflow on any module, and the column fills the width minus the page padding`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 800 })
      for (const slug of SLUGS) {
        await page.goto(`/learn/${slug}`)
        await expect(page.locator('.learn-content h1')).toBeVisible()
        const m = await page.evaluate(() => {
          const col = document.querySelector('.learn-module')!.getBoundingClientRect()
          return { over: document.documentElement.scrollWidth - window.innerWidth, left: col.left, right: window.innerWidth - col.right }
        })
        expect(m.over, slug).toBeLessThanOrEqual(0)
        expect(m.left, slug).toBeGreaterThanOrEqual(0)
        expect(Math.abs(m.left - m.right), slug).toBeLessThanOrEqual(1)
      }
    })
  }

  test('1440px: /about, /methodology and /for-wallets keep their 780px column and 15px text', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const path of ['/about', '/methodology', '/for-wallets']) {
      await page.goto(path)
      await expect(page.locator('.about-text p').first()).toBeVisible()
      const m = await page.evaluate(() => ({
        w: document.querySelector('.about-text')!.getBoundingClientRect().width,
        fs: getComputedStyle([...document.querySelectorAll('.about-text p')].sort((x, y) => y.textContent!.length - x.textContent!.length)[0]!).fontSize,
        li: getComputedStyle(document.querySelector('.about-text li')!).fontSize,
      }))
      expect(m, path).toEqual({ w: 780, fs: '15px', li: '15px' })
    }
  })
})
