import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_MINTS } from './fixtures/mocks'
import { PAGE_META } from '../src/utils/pageMeta'
import { SITE_DESCRIPTION, ROUTE_META_BY_PATH } from '../src/utils/pageMeta'

// One hook (useDocumentMeta) sets title, description, canonical and the social tags per route after load.
// Mocks only. The static head of index.html is replaced on every route, including the root; the not-found
// states have no canonical.

const ORIGIN = 'https://mintradar.org'
const TRACKED = MOCK_MINTS[0]!.url
const UNTRACKED = 'https://mint.minibits.cash/Bitcoin'

interface Expected { path: string; canonical: string | null; title: string; description: string | null }

const ROUTES: Expected[] = [
  { path: '/', canonical: `${ORIGIN}/`, title: 'MintRadar - Cashu Mints Directory & Reliability Score Monitor', description: SITE_DESCRIPTION },
  { path: '/about', canonical: `${ORIGIN}/about`, title: 'About and privacy | MintRadar', description: 'What MintRadar is, how it measures Cashu mints, what data it keeps about you and the rules of using it.' },
  { path: '/learn', canonical: `${ORIGIN}/learn`, title: 'Learn Cashu - MintRadar', description: 'A short course on how Cashu works, what can go wrong, and how to choose a safe Cashu mint.' },
  { path: '/learn/cashu-basics', canonical: `${ORIGIN}/learn/cashu-basics`, title: 'Cashu Basics - MintRadar Learn', description: null },
  { path: '/stats', canonical: `${ORIGIN}/stats`, title: 'Cashu Mints Network Stats - MintRadar', description: 'Live network-wide stats for Cashu mints: uptime, average Reliability Score, latency, NUT adoption and the Network Health Index.' },
  { path: '/tools', canonical: `${ORIGIN}/tools`, title: 'Cashu Mint Tools - Token Inspector & Best Mint Finder | MintRadar', description: 'Inspect a Cashu token before redeeming it, or find the best Cashu mint for you with the Best Mint wizard.' },
  { path: '/wallets', canonical: `${ORIGIN}/wallets`, title: 'Cashu Wallets - MintRadar', description: 'Wallets that work with Cashu mints, plus how to run your own mint. A plain list, no ranking or reviews.' },
  { path: '/watchlist', canonical: `${ORIGIN}/watchlist`, title: 'My Watchlist - MintRadar', description: 'Track your favorite Cashu mints and optionally get a Nostr DM when one goes offline or comes back online.' },
  { path: '/nuts', canonical: `${ORIGIN}/nuts`, title: ROUTE_META_BY_PATH['/nuts'].title, description: ROUTE_META_BY_PATH['/nuts'].description },
  { path: '/methodology', canonical: `${ORIGIN}/methodology`, title: PAGE_META['/methodology'].title, description: PAGE_META['/methodology'].description },
  { path: '/for-wallets', canonical: `${ORIGIN}/for-wallets`, title: PAGE_META['/for-wallets'].title, description: PAGE_META['/for-wallets'].description },
]

const canonicalLinks = (page: Page) => page.locator('link[rel="canonical"]')
const meta = (page: Page, sel: string) => page.locator(sel)
const SOCIAL = {
  ogUrl: 'meta[property="og:url"]',
  ogTitle: 'meta[property="og:title"]',
  ogDescription: 'meta[property="og:description"]',
  twTitle: 'meta[name="twitter:title"]',
  twDescription: 'meta[name="twitter:description"]',
} as const

async function expectHead(page: Page, e: Expected): Promise<void> {
  await expect(page).toHaveTitle(e.title)
  await expect(canonicalLinks(page)).toHaveCount(1)
  await expect(canonicalLinks(page)).toHaveAttribute('href', e.canonical!)
  await expect(meta(page, SOCIAL.ogUrl)).toHaveAttribute('content', e.canonical!)
  await expect(meta(page, SOCIAL.ogTitle)).toHaveAttribute('content', e.title)
  await expect(meta(page, SOCIAL.twTitle)).toHaveAttribute('content', e.title)
  const description = e.description ?? (await meta(page, 'meta[name="description"]').getAttribute('content'))
  expect(description).toBeTruthy()
  await expect(meta(page, 'meta[name="description"]')).toHaveAttribute('content', description!)
  await expect(meta(page, SOCIAL.ogDescription)).toHaveAttribute('content', description!)
  await expect(meta(page, SOCIAL.twDescription)).toHaveAttribute('content', description!)
  for (const sel of Object.values(SOCIAL)) await expect(meta(page, sel)).toHaveCount(1)
}

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

for (const e of ROUTES) {
  test(`${e.path}: canonical, og:* and twitter:* are set per route after load`, async ({ page }) => {
    await page.goto(e.path)
    await expectHead(page, e)
  })
}

test('a tracked mint page: canonical and og:url are its own path, the title is the page title', async ({ page }) => {
  await page.goto(`/mint/${encodeURIComponent(TRACKED)}`)
  const canonical = `${ORIGIN}/mint/${encodeURIComponent(TRACKED)}`
  await expect(page).toHaveTitle(/ - Cashu Mint Reliability Score & Uptime \| MintRadar$/)
  const title = await page.title()
  await expect(canonicalLinks(page)).toHaveCount(1)
  await expect(canonicalLinks(page)).toHaveAttribute('href', canonical)
  await expect(meta(page, SOCIAL.ogUrl)).toHaveAttribute('content', canonical)
  await expect(meta(page, SOCIAL.ogTitle)).toHaveAttribute('content', title)
  await expect(meta(page, SOCIAL.twTitle)).toHaveAttribute('content', title)
  const description = await meta(page, 'meta[name="description"]').getAttribute('content')
  expect(description).toContain('Reliability Score')
  await expect(meta(page, SOCIAL.ogDescription)).toHaveAttribute('content', description!)
  await expect(meta(page, SOCIAL.twDescription)).toHaveAttribute('content', description!)
})

const robots = (page: Page) => page.locator('meta[name="robots"]')
// Crawlers that do not run JavaScript still see status 200 and the static head for an unknown path; these tests
// cover what the browser sets after load (docs/claude/mobile-and-tooltips.md is not involved, see
// docs/claude/deploy-and-infra.md "Not-found pages").
test.describe('not-found states have no canonical and are noindex, follow', () => {
  test('/learn/99 (unknown module)', async ({ page }) => {
    await page.goto('/learn/99')
    await expect(page.getByText('Module not found.')).toBeVisible()
    await expect(page).toHaveTitle('Module not found - MintRadar Learn')
    await expect(canonicalLinks(page)).toHaveCount(0)
    await expect(robots(page)).toHaveCount(1)
    await expect(robots(page)).toHaveAttribute('content', 'noindex, follow')
  })

  test('an untracked mint', async ({ page }) => {
    await page.goto(`/mint/${encodeURIComponent(UNTRACKED)}`)
    await expect(page.getByRole('heading', { name: 'Not a tracked mint' })).toBeVisible()
    await expect(canonicalLinks(page)).toHaveCount(0)
    await expect(robots(page)).toHaveCount(1)
    await expect(robots(page)).toHaveAttribute('content', 'noindex, follow')
  })

  test('an unknown route', async ({ page }) => {
    await page.goto('/no-such-page')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page).toHaveTitle('Page not found | MintRadar')
    await expect(canonicalLinks(page)).toHaveCount(0)
    await expect(robots(page)).toHaveCount(1)
    await expect(robots(page)).toHaveAttribute('content', 'noindex, follow')
  })

  test('an invalid mint URL', async ({ page }) => {
    await page.goto('/mint/%25E0')
    await expect(page.getByRole('heading', { name: 'Invalid mint URL.' })).toBeVisible()
    await expect(canonicalLinks(page)).toHaveCount(0)
    await expect(robots(page)).toHaveCount(1)
    await expect(robots(page)).toHaveAttribute('content', 'noindex, follow')
  })

  test('/about and a tracked mint page are indexable (no robots tag)', async ({ page }) => {
    await page.goto('/about')
    await expect(canonicalLinks(page)).toHaveCount(1)
    await expect(robots(page)).toHaveCount(0)
    await page.goto(`/mint/${encodeURIComponent(TRACKED)}`)
    await expect(page).toHaveTitle(/ - Cashu Mint Reliability Score & Uptime \| MintRadar$/)
    await expect(canonicalLinks(page)).toHaveCount(1)
    await expect(robots(page)).toHaveCount(0)
  })
})

test('the noindex of a not-found page is removed by a navigation to /about', async ({ page }) => {
  await page.goto('/learn/99')
  await expect(page.getByText('Module not found.')).toBeVisible()
  await expect(robots(page)).toHaveAttribute('content', 'noindex, follow')

  await page.getByRole('link', { name: 'Back to Learn' }).click()
  await expect(page).toHaveURL(/\/learn$/)
  await expect(robots(page)).toHaveCount(0)
  await expect(canonicalLinks(page)).toHaveCount(1)

  await page.getByRole('link', { name: 'About' }).first().click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(robots(page)).toHaveCount(0)
  await expect(canonicalLinks(page)).toHaveAttribute('href', `${ORIGIN}/about`)
})

test('a navigation by link replaces every tag', async ({ page }) => {
  const about = ROUTES.find(r => r.path === '/about')!
  const stats = ROUTES.find(r => r.path === '/stats')!
  await page.goto('/about')
  await expectHead(page, about)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Stats' }).click()
  await expect(page).toHaveURL(/\/stats$/)
  await expectHead(page, stats)
})
