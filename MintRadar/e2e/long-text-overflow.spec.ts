import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  installApiMocks, loginAs, probePayload, makeCashuToken,
  MOCK_KNOWN_MINTS, MOCK_STATS, MOCK_RELIABILITY_MOVERS,
} from './fixtures/mocks'

// Data-driven text (mint names, hostnames, URLs, operator notices, descriptions, NIP-05 values,
// reviewer names, version strings, review texts) comes from third parties, so no length of it may
// widen the page or push a card / tile / chip off screen. Every case below is rendered at the
// narrow widths where the layout is single-column; each page is checked twice:
//   1. document.documentElement.scrollWidth <= clientWidth (1px tolerance), and
//   2. the right edge of the page's main content elements lies inside the viewport.

const WIDTHS = [320, 360, 390, 768] as const

const SPACED = 'The Extraordinarily Long Named Community Cashu Mint of Satoshi Nakamoto Memorial Foundation and Friends Club'
const spaced = (n: number) => SPACED.slice(0, n).trimEnd().padEnd(n, 'x').slice(0, n)
const WORD60 = 'Supercalifragilisticexpialidocious'.padEnd(60, 'x').slice(0, 60)
const TOKEN120 = `${'x'.repeat(40)}-${'y'.repeat(40)}-${'z'.repeat(38)}`
const LOREM = 'Operators of this mint reserve the right to change fees, limits and availability without prior notice, and users should keep balances small. '
const SUB60 = `long-subdomain-label-for-testing-${'a'.repeat(30)}`.slice(0, 60)

const T_URL = 'https://under.test.example'
const authorSk = generateSecretKey()
const authorPk = getPublicKey(authorSk)
const reviewerSk = generateSecretKey()
const reviewerPk = getPublicKey(reviewerSk)

interface Case {
  /** URL of the mint under test (defaults to T_URL). */
  url?: string
  name?: string
  /** Fields merged into the /api/mints/known row. */
  known?: Record<string, unknown>
  /** Fields merged into the probe `info`. */
  info?: Record<string, unknown>
  contact?: { method: string; info: string }[]
  keysets?: { id: string; unit: string; active: boolean; input_fee_ppk: number }[]
  nip05?: string
  reviewerName?: string
  reviewText?: string
}

const CASES: Record<string, Case> = {
  name35: { name: spaced(35) },
  name45: { name: spaced(45) },
  name91: { name: spaced(91) },
  word60: { name: WORD60 },
  host60: { url: `https://${SUB60}.example.com` },
  urlpath: { url: `https://paths.example.com/${'api/v1/cashu/some/very/long/path/segment/'.repeat(4)}mint` },
  notice: { info: { motd: LOREM.repeat(4) + TOKEN120 } },
  noticeAlert: { info: { motd: `Scheduled maintenance: ${LOREM.repeat(4)}${TOKEN120}` } },
  description: { info: { description: LOREM.repeat(3) + TOKEN120 } },
  descriptionFull: { info: { description_long: LOREM.repeat(8) + TOKEN120 }, known: { descriptionLong: LOREM.repeat(8) + TOKEN120 } },
  nip05: { nip05: `${'a'.repeat(60)}@${'b'.repeat(60)}.example.com` },
  contact: { contact: [
    { method: 'email', info: `${'e'.repeat(70)}@${'d'.repeat(40)}.example.com` },
    { method: 'twitter', info: `@${'t'.repeat(60)}` },
    { method: 'nostr', info: `npub1${'q'.repeat(100)}` },
  ] },
  reviewer60: { reviewerName: WORD60 },
  reviewText: { reviewText: LOREM + TOKEN120 + TOKEN120 },
  version50: { known: { version: `Nutshell/0.16.0-${'v'.repeat(34)}` }, info: { version: `Nutshell/0.16.0-${'v'.repeat(34)}` } },
  units5: { known: { units: ['sat', 'usd', 'eur', 'gbp', 'chf'] }, keysets: ['sat', 'usd', 'eur', 'gbp', 'chf'].map((unit, i) => ({ id: `00ad268c4d1f58${10 + i}`, unit, active: true, input_fee_ppk: 0 })) },
  tos: { known: { tosUrl: `https://example.com/${'terms/of/service/'.repeat(8)}` }, info: { tos_url: `https://example.com/${'terms/of/service/'.repeat(8)}` } },
  lastError: { known: { online: false, lastError: `Connection failed: ${TOKEN120} ${LOREM}` } },
}

async function mount(page: Page, c: Case, opts: { login?: boolean; width: number }) {
  const url = c.url ?? T_URL
  const name = c.name ?? 'Under Test Mint'
  const base = MOCK_KNOWN_MINTS[0]!
  const units = (c.known?.['units'] as string[] | undefined) ?? ['sat']
  const methods = (max: number) => units.map(unit => ({ method: 'bolt11', unit, min_amount: 1, max_amount: max }))
  const known = {
    ...base, url, name, online: true, degraded: false, archived: false, units,
    mintMethods: methods(1_000_000), meltMethods: methods(500_000),
    reliabilityScore: 80, uptimePct24h: 98, latencyMs: 90, reviewCount: 3, reviewAvgRating: 4, reviewWeightedRating: 4,
    ...(c.nip05 ? { nostrAnnouncePubkey: authorPk, nostrAnnounceD: 'under' } : {}),
    ...c.known,
  }
  const degraded = { ...base, url: 'https://degraded.mint.example', name: 'Degraded Mint', online: false, degraded: true, reliabilityScore: 20 }
  const list = [...MOCK_KNOWN_MINTS, known, degraded]
  const now = Math.floor(Date.now() / 1000)

  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: list }))
  await page.route('**/api/stats', r => r.fulfill({ json: {
    ...MOCK_STATS, totalMints: list.length,
    top5ByReliabilityScore: [{ url, name, reliabilityScore: 80 }, ...MOCK_STATS.top5ByReliabilityScore].slice(0, 5),
  } }))
  await page.route('**/api/stats/reliability-movers**', r => r.fulfill({ json: {
    period: '7d',
    risers: [{ url, name, delta: 12 }, ...MOCK_RELIABILITY_MOVERS.risers],
    fallers: [{ url, name, delta: -9 }, ...MOCK_RELIABILITY_MOVERS.fallers],
  } }))
  await page.route('**/api/mint/probe**', r => {
    const target = new URL(r.request().url()).searchParams.get('url') ?? ''
    const p = probePayload(target)
    if (target === url) {
      p.info = { ...p.info, name, ...c.info, contact: c.contact ?? p.info.contact } as typeof p.info
      if (c.keysets) p.keysets = c.keysets
    }
    r.fulfill({ json: p })
  })

  const review = c.reviewerName || c.reviewText
    ? finalizeEvent({ kind: 38000, created_at: now, tags: [['u', url], ['rating', '4']], content: c.reviewText ?? 'Great mint.' }, reviewerSk)
    : null
  await page.route('**/api/mints/nostr-reviews**', r => r.fulfill({
    json: review ? [{ id: review.id, pubkey: review.pubkey, content: review.content, rating: 4, createdAt: review.created_at, source: 'nostr' }] : [],
  }))
  const reviewerProfile = finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ name: c.reviewerName ?? 'Reviewer' }) }, reviewerSk)
  const authorProfile = c.nip05 ? finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ nip05: c.nip05 }) }, authorSk) : null
  await page.routeWebSocket(/^wss:\/\//, ws => ws.onMessage(message => {
    let p: unknown
    try { p = JSON.parse(String(message)) } catch { return }
    if (!Array.isArray(p)) return
    const [verb, subId, filter] = p as [string, string, { kinds?: number[]; authors?: string[] } | undefined]
    if (verb === 'REQ') {
      if (filter?.kinds?.includes(0)) {
        if (authorProfile && filter.authors?.includes(authorPk)) ws.send(JSON.stringify(['EVENT', subId, authorProfile]))
        if (filter.authors?.includes(reviewerPk)) ws.send(JSON.stringify(['EVENT', subId, reviewerProfile]))
      }
      ws.send(JSON.stringify(['EOSE', subId]))
    } else if (verb === 'EVENT') {
      ws.send(JSON.stringify(['OK', (p[1] as { id: string }).id, true, '']))
    }
  }))
  if (opts.login) await loginAs(page)
  await page.setViewportSize({ width: opts.width, height: 900 })
  return { url, name }
}

/** Main content elements whose right edge must stay inside the viewport. */
const CONTENT = [
  '.mint-card', '.mint-list-row', '.degraded-note', '.filter-panel', '.stat-card', '.stats-panel',
  '.md-panel', '.md-sc', '.md-tab', '.md-motd', '.md-mint-alert', '.md-contact-card', '.audit-summary-cell',
  '.review-card', '.cmp-modal', '.md-picker-item', '.tool-card', '.wizard-rec-row', '.token-result-grid',
].join(',')

async function expectNoOverflow(page: Page, where: string) {
  await page.waitForTimeout(150)
  const m = await page.evaluate((sel) => {
    const cw = document.documentElement.clientWidth
    // An element wider than the viewport is fine when it sits inside its own horizontal scroller
    // (tab strip, list table wrapper) that itself fits on screen.
    const scrolled = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) {
          const r = a.getBoundingClientRect()
          if (r.right <= cw + 1 && r.left >= -1) return true
        }
      }
      return false
    }
    const outside = [...document.querySelectorAll(sel)].flatMap(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && (r.right > cw + 1 || r.left < -1) && !scrolled(el)
        ? [`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} left=${Math.round(r.left)} right=${Math.round(r.right)}`]
        : []
    })
    return { cw, sw: document.documentElement.scrollWidth, outside }
  }, CONTENT)
  expect(m.sw, `${where}: scrollWidth ${m.sw} > clientWidth ${m.cw}`).toBeLessThanOrEqual(m.cw + 1)
  expect(m.outside, `${where}: content elements outside the viewport`).toEqual([])
}

const cardCases = ['name35', 'name45', 'name91', 'word60', 'host60'] as const
const detailCases = [
  'name91', 'word60', 'host60', 'urlpath', 'notice', 'noticeAlert', 'description', 'descriptionFull', 'nip05',
  'contact', 'reviewer60', 'reviewText', 'version50', 'units5', 'tos', 'lastError',
] as const

for (const width of WIDTHS) {
  test.describe(`no horizontal overflow @ ${width}px`, () => {
    for (const key of cardCases) {
      test(`Dashboard grid + Filters + hidden-mints banner — ${key}`, async ({ page }) => {
        await mount(page, CASES[key]!, { width })
        await page.goto('/')
        await expect(page.locator('.mint-card').first()).toBeVisible()
        await expect(page.locator('.degraded-note')).toBeVisible()
        await page.locator('.filter-btn').click()
        await expect(page.locator('.filter-panel')).toBeVisible()
        await expectNoOverflow(page, `dashboard/${key}`)
      })

      test(`Dashboard list view — ${key}`, async ({ page }) => {
        await mount(page, CASES[key]!, { width })
        await page.addInitScript(() => localStorage.setItem('mintRadar_viewMode', 'list'))
        await page.goto('/')
        await expect(page.locator('.mint-list-row').first()).toBeVisible()
        await expectNoOverflow(page, `dashboard-list/${key}`)
      })

      test(`Watchlist — ${key}`, async ({ page }) => {
        await mount(page, CASES[key]!, { width, login: true })
        await page.goto('/')
        await expect(page.locator('.mint-card').first()).toBeVisible()
        const watch = page.getByRole('button', { name: /^Add .+ to watchlist$/ })
        for (let n = await watch.count(); n > 0; n--) {
          await watch.first().click()
          await expect(watch).toHaveCount(n - 1)
        }
        await page.getByRole('link', { name: 'Watchlist' }).click()
        await expect(page.locator('.wl-grid .mint-card').first()).toBeVisible()
        await expectNoOverflow(page, `watchlist/${key}`)
      })

      test(`Compare picker + Comparison modal — ${key}`, async ({ page }) => {
        const { name } = await mount(page, CASES[key]!, { width })
        await page.goto('/?status=all')
        await expect(page.locator('.mint-card').first()).toBeVisible()
        await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
        await expect(page.locator('.md-picker-item').first()).toBeVisible()
        await expectNoOverflow(page, `compare-picker/${key}`)
        await page.locator('.md-picker-item', { hasText: name.slice(0, 12) }).first().click()
        await page.locator('.md-picker-confirm').click()
        await expect(page.locator('.cmp-modal')).toBeVisible()
        await expectNoOverflow(page, `compare-modal/${key}`)
      })

      test(`Stats — ${key}`, async ({ page }) => {
        await mount(page, CASES[key]!, { width })
        await page.goto('/stats')
        await expect(page.locator('.stat-card').first()).toBeVisible()
        await expectNoOverflow(page, `stats/${key}`)
      })
    }

    for (const key of ['name91', 'word60'] as const) {
      test(`Tools — Token Inspector + Best Mint results — ${key}`, async ({ page }) => {
        const { url } = await mount(page, CASES[key]!, { width })
        await page.goto('/tools')
        await page.locator('.token-input').fill(makeCashuToken(url, [21, 8]))
        await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
        await expect(page.locator('.token-result-grid')).toBeVisible()
        await expectNoOverflow(page, `tools-inspect/${key}`)
        await page.reload()
        await page.getByRole('radio', { name: 'SAT', exact: true }).click()
        await page.locator('.wizard-opt', { hasText: 'Small' }).click()
        await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
        await page.getByRole('button', { name: /Find my mint/ }).click()
        await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
        await expectNoOverflow(page, `tools-wizard/${key}`)
      })
    }

    for (const key of detailCases) {
      test(`Mint Detail (all tabs) — ${key}`, async ({ page }) => {
        const { url } = await mount(page, CASES[key]!, { width })
        await page.goto(`/mint/${encodeURIComponent(url)}`)
        await expect(page.locator('.md-tabs')).toBeVisible()
        for (const tab of ['Overview', 'History', 'NUTs', 'Audit', 'Reviews']) {
          await page.locator('.md-tab', { hasText: tab }).click()
          await expectNoOverflow(page, `detail-${tab}/${key}`)
        }
      })
    }

    test('Watchlist empty state', async ({ page }) => {
      await mount(page, {}, { width, login: true })
      await page.goto('/watchlist')
      await expect(page.locator('.wl-grid .mint-card')).toHaveCount(0)
      await expectNoOverflow(page, 'watchlist-empty')
    })

    test('Audit tab: every summary tile keeps its text inside the tile', async ({ page }) => {
      const { url } = await mount(page, {}, { width })
      await page.goto(`/mint/${encodeURIComponent(url)}`)
      await expect(page.locator('.md-tabs')).toBeVisible()
      await page.locator('.md-tab', { hasText: 'Audit' }).click()
      await expect(page.locator('.audit-summary-cell').first()).toBeVisible()
      const spill = await page.locator('.audit-summary-cell').evaluateAll(cells => cells.flatMap(cell => {
        const box = cell.getBoundingClientRect()
        return [...cell.querySelectorAll('span')].flatMap(s => {
          const r = s.getBoundingClientRect()
          return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1) ? [`${s.className} ${Math.round(r.right)} > ${Math.round(box.right)}`] : []
        })
      }))
      expect(spill).toEqual([])
    })
  })
}

// ── Small container overflows (2026-10-02) ───────────────────────────────────────────────────────
// Elements that did not widen the page but stuck out of (or were scrolled out of) their own container.
// Known and deliberately NOT asserted: the Mint Detail header buttons at 352–376px (Cashu.me clipped by
// ≤3.3px, Mint QR icon squeezed to 0 — fixing it changes the buttons at normal phone widths), the 1.6px
// Unit info icon in its fixed-width label cell, and the Stats Geography rows' intentional -4px hover bleed.

/** Selector matches whose box leaves their nearest non-`display:contents` parent's box by more than 1px. */
async function leavingParent(page: Page, selector: string): Promise<string[]> {
  await page.waitForTimeout(250)
  return page.evaluate(sel => [...document.querySelectorAll(sel)].flatMap(el => {
    let p = el.parentElement
    while (p && getComputedStyle(p).display === 'contents') p = p.parentElement
    const r = el.getBoundingClientRect()
    if (!p || r.width === 0) return []
    const pr = p.getBoundingClientRect()
    const out = Math.max(r.right - pr.right, pr.left - r.left)
    return out > 1 ? [`${el.className} "${(el.textContent ?? '').trim().slice(0, 24)}" leaves ${p.className} by ${out.toFixed(1)}px`] : []
  }), selector)
}

for (const width of WIDTHS) {
  test.describe(`container overflows @ ${width}px`, () => {
    test('Dashboard: sort buttons fit inside the sort segment (no inner scrolling)', async ({ page }) => {
      await mount(page, {}, { width })
      await page.goto('/')
      await expect(page.locator('.sort-segment')).toBeVisible()
      await page.waitForTimeout(250)
      const seg = await page.locator('.sort-segment').evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth }))
      expect(seg.sw, `sort-segment scrollWidth ${seg.sw} > clientWidth ${seg.cw}`).toBeLessThanOrEqual(seg.cw + 1)
      expect(await leavingParent(page, '.sort-btn')).toEqual([])
    })

    test('Stats: hero notes stay inside their tile', async ({ page }) => {
      await mount(page, {}, { width })
      await page.goto('/stats')
      await expect(page.locator('.stats-metrics .stat-note').first()).toBeVisible()
      expect(await leavingParent(page, '.stats-metrics .stat-note')).toEqual([])
    })

    test('Mint Detail: History summary cards stay inside their grid', async ({ page }) => {
      const { url } = await mount(page, {}, { width })
      await page.goto(`/mint/${encodeURIComponent(url)}`)
      await expect(page.locator('.md-tabs')).toBeVisible()
      await page.locator('.md-tab', { hasText: 'History' }).click()
      await expect(page.locator('.md-hist-summary')).toBeVisible()
      expect(await leavingParent(page, '.md-hist-summary > div')).toEqual([])
    })

    test('Mint Detail: a very long lastError badge stays inside the header', async ({ page }) => {
      const { url } = await mount(page, CASES['lastError']!, { width })
      await page.route('**/api/mint/probe**', r => r.fulfill({ status: 502, json: { error: 'down' } }))
      await page.goto(`/mint/${encodeURIComponent(url)}`)
      await expect(page.locator('.md-error-badge')).toBeVisible()
      expect(await leavingParent(page, '.md-error-badge')).toEqual([])
      const vw = await page.evaluate(() => document.documentElement.clientWidth)
      const right = await page.locator('.md-error-badge').evaluate(el => el.getBoundingClientRect().right)
      expect(right).toBeLessThanOrEqual(vw)
    })
  })
}
