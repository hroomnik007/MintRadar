import { expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS, probePayload, makeCashuTokenV4 } from './mocks'
import { auditCzResponse, czSwapList, NOT_COVERED, SWAPS_8333 } from './auditCz'
import { openWatchlist, URLS } from './watchlistNotify'
import { frames, layoutReady } from './settle'

// Pages and states that carry tooltips, used by e2e/tooltips-contract.spec.ts (and by the one-off
// extraction that produced e2e/fixtures/tooltip-texts.json). Every state is rebuilt from the repo's own
// mocks plus a few mint variants: a normal mint with reviews and a review surge, a test mint, a new mint
// (score capped), a mint whose operator wrote a review, an offline mint with an HTTP error, and a mint
// that shares its operator key with another one.

const D = 86_400_000
const daysAgo = (d: number) => new Date(Date.now() - d * D).toISOString()

export const [ALPHA, BRAVO, CHARLIE] = MOCK_MINTS.map(m => m.url) as [string, string, string]
export const TEST_MINT = 'https://testnut.cashu.space'
export const NEW_MINT = 'https://newbie.mint.example'
export const OPERATOR_MINT = 'https://operator.mint.example'
export const TWIN_MINT = 'https://twin.mint.example'

const opSk = generateSecretKey()
const OPERATOR_PK = getPublicKey(opSk)
const OPERATOR_NPUB = nip19.npubEncode(OPERATOR_PK)
const reviewerPk = getPublicKey(generateSecretKey())
const SAME_OP_PK = '02' + 'cd'.repeat(32)

const base = MOCK_KNOWN_MINTS[0]!
const mk = (over: Record<string, unknown>) => ({ ...base, ...over })

export const KNOWN_VARIANTS = [
  ...MOCK_KNOWN_MINTS.map(m => (
    m.url === ALPHA ? { ...m, reviewSurge: true, pubkey: SAME_OP_PK, ipAddress: '203.0.113.7', netAsn: 64500, netOrg: 'AS64500 - Example Hosting, Inc', netCountry: 'DE', hasOnion: true }
      : m.url === CHARLIE ? { ...m, lastError: 'HTTP 502' }
        : m
  )),
  mk({ url: TWIN_MINT, name: 'Twin Mint', pubkey: SAME_OP_PK, reliabilityScore: 88, discoveredAt: daysAgo(250) }),
  mk({ url: TEST_MINT, name: 'Test Nut', reliabilityScore: 70, reviewCount: 0, reviewAvgRating: null, reviewWeightedRating: null, discoveredAt: daysAgo(500) }),
  mk({
    url: NEW_MINT, name: 'Newbie Mint', nutCount: 3, nutsLimits: { '4': { methods: [] }, '5': { methods: [] }, '7': { methods: [] } },
    reliabilityScore: 75, discoveredAt: daysAgo(3), reviewCount: 0, reviewAvgRating: null, reviewWeightedRating: null, auditCzTotal: 4, auditCzBlamed: 0,
  }),
  mk({
    url: OPERATOR_MINT, name: 'Operator Mint', reliabilityScore: 84, reviewCount: 3, reviewAvgRating: 4, reviewWeightedRating: 3.8, discoveredAt: daysAgo(150),
    nostrAnnouncePubkey: OPERATOR_PK, nostrAnnounceD: 'op-d-tag',
  }),
]

const review = (i: number, rating: number | null, pubkey = reviewerPk, content = `Review ${i}: works well for small amounts.`) => ({
  id: String(i).padStart(2, '0').repeat(32), pubkey, content, rating, createdAt: Math.floor(Date.now() / 1000) - i * 3600, source: 'nostr',
})
const reviewsFor = (url: string) => {
  if (url === ALPHA) return [review(1, 5), review(2, 4, reviewerPk, 'Solid.'), review(3, 2, reviewerPk, 'Had a failed melt once.')]
  if (url === OPERATOR_MINT) return [review(5, 5, OPERATOR_PK, 'We run this mint.'), review(6, 4)]
  return []
}

/** Mocks for every page below (call before goto). */
export async function installTooltipMocks(page: Page): Promise<void> {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN_VARIANTS }))
  await page.route('**/api/mints/audit-cz**', r => {
    const url = new URL(r.request().url()).searchParams.get('url') ?? ''
    if (url === ALPHA || url === OPERATOR_MINT) {
      return r.fulfill({ json: auditCzResponse({ swaps: czSwapList([{ kind: 'a' }, { kind: 'b', status: 'failed', error: 'melt quote failed' }, { kind: 'c' }, { kind: 'd' }]), stats7d: { total: 126, success: 107 } }) })
    }
    return r.fulfill({ json: NOT_COVERED })
  })
  await page.route('**/api/mints/swaps**', r => r.fulfill({ json: SWAPS_8333 }))
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: 3 * D, avgRecoveryMs: 600_000, outageCount: 2, outages: [{ startedAt: daysAgo(3), durationMs: 600_000, error: 'timeout' }] } }))
  await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({ json: reviewsFor(new URL(r.request().url()).searchParams.get('url') ?? '') }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: { success: true } }))
  await page.route('**/api/nip05/verify**', r => r.fulfill({ json: { verified: false } }))
  await page.route('**/api/mint/icon**', r => r.fulfill({ status: 404, body: '' }))
  await page.route('**/api/nuts', r => r.fulfill({ json: ['4', '5', '7', '8', '9', '10', '11', '12', '14', '15', '17', '19', '20', '29'].map((n, i) => ({ nut: `NUT-${n.padStart(2, '0')}`, percent: 90 - i * 5, count: 9 - (i % 4), mints: [ALPHA, TEST_MINT] })) }))
  await page.route('**/api/mint/probe**', r => {
    const target = new URL(r.request().url()).searchParams.get('url') ?? ''
    const p = probePayload(target)
    const info = {
      ...p.info,
      name: KNOWN_VARIANTS.find(m => m.url === target)?.name ?? p.info.name,
      ...(target === NEW_MINT ? { nuts: { '4': { methods: [] }, '5': { methods: [] }, '7': { methods: [] } } } : {}),
      ...(target === OPERATOR_MINT ? { contact: [{ method: 'nostr', info: OPERATOR_NPUB }, { method: 'email', info: 'op@example.com' }] } : {}),
    }
    r.fulfill({ json: { ...p, info } })
  })
}

export const mintPath = (url: string, hash = '') => `/mint/${encodeURIComponent(url)}${hash}`

export interface TooltipState {
  id: string
  /** Sets the page up and brings it into the state. Resolves false when the state does not exist at this viewport. */
  run: (page: Page) => Promise<boolean>
}

const settle = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded')
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined)
  await layoutReady(page)
}
const page_ = (id: string, path: string, wait?: (p: Page) => Promise<void>): TooltipState => ({
  id,
  run: async page => {
    await installTooltipMocks(page)
    await page.goto(path)
    if (wait) await wait(page)
    await settle(page)
    return true
  },
})
const mint = (id: string, url: string, tab: string, extra?: (p: Page) => Promise<void>): TooltipState => ({
  id: `mint-${id}-${tab}`,
  run: async page => {
    await installTooltipMocks(page)
    await page.goto(mintPath(url, `#${tab}`))
    await expect(page.locator('.md-tabs')).toBeVisible()
    await settle(page)
    if (extra) await extra(page)
    return true
  },
})

const clickIfPresent = async (page: Page, sel: string): Promise<boolean> => {
  const el = page.locator(sel).first()
  if (!(await el.isVisible().catch(() => false))) return false
  await el.click()
  await frames(page)
  return true
}

export const TOOLTIP_STATES: TooltipState[] = [
  page_('home', '/?status=all', p => expect(p.locator('.mint-card').first()).toBeVisible()),
  {
    id: 'home-filters',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/?status=all')
      await expect(page.locator('.mint-card').first()).toBeVisible()
      await page.locator('.filter-btn').click()
      await expect(page.locator('.filter-panel')).toBeVisible()
      await settle(page)
      return true
    },
  },
  {
    id: 'home-filters-hidetest',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/?status=all&testmints=hide')
      await expect(page.locator('.mint-card').first()).toBeVisible()
      // the "Test mints hidden" tag lives in the open filter panel
      await page.locator('.filter-btn').click()
      await expect(page.locator('.filter-active-tags .filter-tag', { hasText: 'Test mints hidden' })).toBeVisible()
      await settle(page)
      return true
    },
  },
  {
    id: 'watchlist-3-notify',
    run: async page => {
      const size = page.viewportSize() ?? { width: 1440, height: 900 }
      await page.route('**/api/notifications/**', r => r.fulfill({ json: { success: true } }))
      await openWatchlist(page, {
        urls: URLS.slice(0, 3), size,
        seed: [{ url: URLS[0]!, down: true, up: true, confirmed: true }],
      })
      await page.reload()
      await expect(page.locator('.wl-grid .mint-card')).toHaveCount(3)
      await page.locator('.wl-grid .notify-strip').first().getByRole('button', { name: /More alerts/ }).click().catch(() => undefined)
      await settle(page)
      return true
    },
  },
  page_('stats', '/stats', p => expect(p.locator('.nhi-gauge-wrap')).toBeVisible()),
  {
    id: 'stats-software-modal',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/stats')
      await expect(page.locator('.sw-row').first()).toBeVisible()
      await page.locator('.sw-row').first().click()
      await expect(page.locator('.nut-modal')).toBeVisible()
      await settle(page)
      return true
    },
  },
  {
    id: 'stats-nhi-dialog',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/stats')
      await expect(page.locator('.nhi-gauge-wrap')).toBeVisible()
      await page.locator('.nhi-gauge-wrap').click()
      if (!(await page.locator('[role=dialog]').isVisible().catch(() => false))) return false
      await settle(page)
      return true
    },
  },
  page_('tools', '/tools'),
  {
    id: 'tools-token-test-mint',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/tools')
      await page.locator('textarea').first().fill(makeCashuTokenV4(TEST_MINT, [8, 4, 2, 1]))
      await page.getByRole('button', { name: /inspect/i }).first().click()
      await settle(page)
      return true
    },
  },
  page_('wallets', '/wallets'),
  page_('learn', '/learn'),
  page_('learn-module', '/learn/cashu-basics'),
  page_('about', '/about'),
  page_('methodology', '/methodology'),
  page_('for-wallets', '/for-wallets'),
  page_('nuts', '/nuts'),
  mint('alpha', ALPHA, 'overview'),
  mint('alpha', ALPHA, 'history'),
  mint('alpha', ALPHA, 'nuts'),
  mint('alpha', ALPHA, 'audit'),
  {
    // The cashu.info view of the Audit tab (segment "cashu.info"): its tiles, heading and swap tables carry tooltips.
    id: 'mint-alpha-audit-cz',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto(mintPath(ALPHA, '#audit'))
      await expect(page.locator('.md-tabs')).toBeVisible()
      await settle(page)
      if (!(await clickIfPresent(page, 'button.md-audit-seg-btn:has-text("cashu.info") >> visible=true'))) return false
      await expect(page.locator('.audit-cz-tiles [data-tile]').first()).toBeVisible()
      await settle(page)
      return true
    },
  },
  {
    id: 'mint-alpha-audit-8333',
    run: async page => {
      await installTooltipMocks(page)
      await page.route('**/api/mints/audit-cz**', r => r.fulfill({ json: NOT_COVERED }))
      await page.goto(mintPath(ALPHA, '#audit'))
      await expect(page.locator('.md-tabs')).toBeVisible()
      await settle(page)
      return true
    },
  },
  mint('alpha', ALPHA, 'reviews'),
  {
    id: 'mint-alpha-score-dialog',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto(mintPath(ALPHA, '#overview'))
      await expect(page.locator('.md-tabs')).toBeVisible()
      await settle(page)
      if (!(await clickIfPresent(page, '.md-sc.md-sc-reliability'))) return false
      if (!(await page.locator('[role=dialog]').isVisible().catch(() => false))) return false
      return true
    },
  },
  mint('offline', CHARLIE, 'overview'),
  mint('test', TEST_MINT, 'overview'),
  mint('test', TEST_MINT, 'audit'),
  mint('new', NEW_MINT, 'overview'),
  mint('new', NEW_MINT, 'nuts'),
  mint('operator', OPERATOR_MINT, 'overview'),
  mint('operator', OPERATOR_MINT, 'reviews'),
  {
    id: 'compare-modal',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/?status=all')
      await expect(page.locator('.mint-card').first()).toBeVisible()
      await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
      await page.locator('.md-picker-item', { hasText: 'Bravo Mint' }).click()
      await page.locator('.md-picker-confirm').click()
      await expect(page.getByText('Mint Comparison')).toBeVisible()
      await settle(page)
      return true
    },
  },
  {
    id: 'submit-modal',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/')
      await expect(page.locator('.mint-card').first()).toBeVisible()
      if (!(await clickIfPresent(page, '.submit-btn'))) return false
      await expect(page.locator('.submit-modal')).toBeVisible()
      return true
    },
  },
  {
    id: 'login-modal',
    run: async page => {
      await installTooltipMocks(page)
      await page.goto('/')
      await expect(page.locator('.mint-card').first()).toBeVisible()
      if (!(await clickIfPresent(page, '.navbar-login-btn'))) return false
      if (!(await page.locator('[role=dialog]').isVisible().catch(() => false))) return false
      return true
    },
  },
]

/** The four viewports of the contract plus the desktop one (1440x900). */
export const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const
