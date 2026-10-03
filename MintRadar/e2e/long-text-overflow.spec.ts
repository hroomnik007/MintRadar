import { test, expect, type Page, type Browser } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  installApiMocks, mockRelays, loginAs, probePayload, makeCashuToken,
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

// ── Hero action buttons (Mint QR / Open in Cashu.me / Compare) at 360–388px ─────────────────────
// The single-row, equal-thirds action row clipped "Cashu.me" by up to 3.3px between 360 and ~376px
// (overflow: hidden + centred content). Fixed below 380px; ≥390px must stay exactly as it was.
const HERO_CASES: Record<string, Case> = {
  plain: {},
  name91: { name: spaced(91) },
  // Test mint + "New" badges share the header with the name
  badges: { url: 'https://testnut.cashu.space', name: spaced(45), known: { discoveredAt: new Date().toISOString() } },
}
const heroButtons = (page: Page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth
  return [...document.querySelectorAll('.md-quick-btn, .md-compare-btn')].map(e => {
    const b = e.getBoundingClientRect()
    const border = parseFloat(getComputedStyle(e).borderRightWidth)
    const rg = document.createRange()
    rg.selectNodeContents(e)
    const c = rg.getBoundingClientRect()
    const parent = e.parentElement!.closest('.md-hdr-actions')!.getBoundingClientRect()
    return {
      label: (e.textContent ?? '').trim(), left: b.left, right: b.right, width: b.width, height: b.height,
      clippedBy: Math.max(c.right - (b.right - border), (b.left + border) - c.left, 0),
      outsideContainer: Math.max(b.right - parent.right, parent.left - b.left, 0),
      outsideViewport: Math.max(b.right - vw, -b.left, 0),
    }
  })
})

for (const width of [340, 360, 375, 412, 414, 428]) {
  for (const key of Object.keys(HERO_CASES)) {
    test(`Mint Detail hero buttons are not clipped @ ${width}px — ${key}`, async ({ page }) => {
      const { url } = await mount(page, HERO_CASES[key]!, { width })
      await page.goto(`/mint/${encodeURIComponent(url)}`)
      await expect(page.locator('.md-tabs')).toBeVisible()
      await page.waitForTimeout(250)
      const btns = await heroButtons(page)
      expect(btns).toHaveLength(3)
      for (const b of btns) {
        expect(b.clippedBy, `${b.label}: content clipped by ${b.clippedBy.toFixed(1)}px`).toBeLessThanOrEqual(0.5)
        expect(b.outsideContainer, `${b.label} outside its container`).toBeLessThanOrEqual(0.5)
        expect(b.outsideViewport, `${b.label} outside the viewport`).toBeLessThanOrEqual(0.5)
      }
      await expectNoOverflow(page, `hero/${key}`)
    })
  }
}

// Boxes recorded from the code BEFORE the text-only change (x, width, height; the fixture's plain mint).
const HERO_BOXES: Record<number, { left: number; width: number; height: number }[]> = {
  420: [{ left: 79, width: 85.33, height: 28 }, { left: 170.33, width: 85.34, height: 27 }, { left: 261.67, width: 85.33, height: 27 }],
  1440: [{ left: 943.42, width: 100.53, height: 30 }, { left: 1051.95, width: 162.14, height: 30 }, { left: 1222.09, width: 100.91, height: 30 }],
}
for (const width of [420, 1440]) {
  test(`Mint Detail hero button boxes are unchanged @ ${width}px`, async ({ page }) => {
    const { url } = await mount(page, {}, { width })
    await page.goto(`/mint/${encodeURIComponent(url)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    const btns = await heroButtons(page)
    HERO_BOXES[width]!.forEach((want, i) => {
      for (const k of ['left', 'width', 'height'] as const) {
        expect(Math.abs(btns[i]![k] - want[k]), `${btns[i]!.label}.${k}`).toBeLessThanOrEqual(0.05)
      }
    })
  })
}

// ── Stats hero notes wrap at spaces (2026-10-03) ─────────────────────────────────────────────────
// "all known" / "of all known" / "active mints" / "from Frankfurt": at 701–900px the note column is only
// 25–65px wide. The note shrinks its font with the column so ordinary words stay whole (overflow-wrap:
// break-word, not anywhere); only "Frankfurt" may still break, and only when wider than the column (< ~870px).
for (const width of [700, 740, 768, 800, 900]) {
  test(`Stats notes: no ordinary word is split across lines @ ${width}px`, async ({ page }) => {
    await mount(page, {}, { width })
    await page.goto('/stats')
    await expect(page.locator('.stats-metrics .stat-note').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    const split = await page.evaluate(() => [...document.querySelectorAll('.stats-metrics .stat-note')].flatMap(note => {
      const cs = getComputedStyle(note)
      const node = note.firstChild as Text
      const box = note.getBoundingClientRect().width
      // natural (unwrapped) width of a word at the note's own font
      const probe = document.createElement('span')
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap', font: cs.font, letterSpacing: cs.letterSpacing })
      note.appendChild(probe)
      const out: string[] = []
      for (const m of (node.data).matchAll(/\S+/g)) {
        probe.textContent = m[0]
        const natural = probe.getBoundingClientRect().width
        const rg = document.createRange()
        rg.setStart(node, m.index!)
        rg.setEnd(node, m.index! + m[0].length)
        const lines = new Set([...rg.getClientRects()].map(r => Math.round(r.top))).size
        // Ordinary words must always stay whole; the long city name may break only when it is wider than the column.
        const mustFit = m[0] !== 'Frankfurt' || natural <= box - 0.5
        if (mustFit && lines > 1) out.push(`"${m[0]}" (${natural.toFixed(1)}px in ${box.toFixed(1)}px, ${cs.fontSize}) on ${lines} lines`)
      }
      probe.remove()
      return out
    }))
    expect(split).toEqual([])
  })
}

test('Stats notes use overflow-wrap: break-word, not anywhere', async ({ page }) => {
  await mount(page, {}, { width: 768 })
  await page.goto('/stats')
  const note = page.locator('.stats-metrics .stat-note').first()
  await expect(note).toBeVisible()
  expect(await note.evaluate(el => getComputedStyle(el).overflowWrap)).toBe('break-word')
})

for (const width of [700, 768, 800, 900]) {
  for (const key of ['name91', 'word60', 'host60', 'notice'] as const) {
    test(`Stats hero with long-text fixture ${key} @ ${width}px: no page overflow, notes inside their tile`, async ({ page }) => {
      await mount(page, CASES[key]!, { width })
      await page.goto('/stats')
      await expect(page.locator('.stats-metrics .stat-note').first()).toBeVisible()
      await expectNoOverflow(page, `stats-hero/${key}`)
      expect(await leavingParent(page, '.stats-metrics .stat-note')).toEqual([])
      expect(await leavingParent(page, '.stats-metrics .stat-card')).toEqual([])
    })
  }
}

// ── Hero icons: text-only below 420px (2026-10-03) ───────────────────────────────────────────────
// The Mint QR icon is flex-shrunk below 12px at every width up to 418px while the other two keep theirs. Below
// 420px all three decorative icons are hidden; from 420px they all render at full size.
const heroIcons = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('.md-quick-btn, .md-compare-btn')].map(btn => {
    const icon = btn.querySelector(':scope > svg, :scope > span[aria-hidden="true"]')!
    const cs = getComputedStyle(icon)
    const r = icon.getBoundingClientRect()
    return { display: cs.display, width: r.width, hidden: icon.getAttribute('aria-hidden') === 'true' || icon.tagName === 'svg' }
  }))

for (const width of [320, 340, 360, 375, 390, 400, 412, 414]) {
  test(`Mint Detail hero buttons are text-only @ ${width}px`, async ({ page }) => {
    const { url } = await mount(page, {}, { width })
    await page.goto(`/mint/${encodeURIComponent(url)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await page.waitForTimeout(250)
    for (const ic of await heroIcons(page)) {
      expect(ic.display === 'none' || ic.width === 0, `icon rendered: display ${ic.display}, ${ic.width}px`).toBe(true)
    }
    // text labels and accessible names stay
    await expect(page.getByRole('button', { name: 'Mint QR' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Cashu\.me/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeVisible()
  })
}

const HERO_ICON_WIDTHS: Record<number, number[]> = {
  420: [12, 7.3, 11.3],
  430: [12, 7.3, 11.3],
  1440: [12, 7.4, 12.4],
}
for (const width of [420, 430, 1440]) {
  test(`Mint Detail hero icons keep their size @ ${width}px`, async ({ page }) => {
    const { url } = await mount(page, {}, { width })
    await page.goto(`/mint/${encodeURIComponent(url)}`)
    await expect(page.locator('.md-tabs')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    const icons = await heroIcons(page)
    icons.forEach((ic, i) => {
      expect(ic.display).not.toBe('none')
      expect(Math.abs(ic.width - HERO_ICON_WIDTHS[width]![i]!), `icon ${i}`).toBeLessThanOrEqual(0.3)
    })
  })
}

// ── Hero buttons: 44px touch target (2026-10-03) ─────────────────────────────────────────────────
// With a coarse pointer each button gets an invisible vertical ::before extension; the visible box and the layout
// stay the same. At ≤359px the row wraps (Compare sits 6px under the other two), so there the facing edges get 3px
// and the hit area is 38.5px instead of 44px.
const touchHero = async (browser: Browser, width: number, coarse: boolean) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: coarse, isMobile: coarse })
  const page = await ctx.newPage()
  await installApiMocks(page)
  await mockRelays(page)
  await page.goto('/mint/' + encodeURIComponent('https://alpha.mint.example'))
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
  return { ctx, page }
}
const heroHit = (page: Page) => page.evaluate(() => {
  const btns = [...document.querySelectorAll('.md-quick-btn, .md-compare-btn')]
  const layout = btns.map(b => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(n => Math.round(n * 100) / 100) })
  const hit = btns.map(b => {
    const r = b.getBoundingClientRect()
    const x = r.left + r.width / 2
    let top = r.top, bottom = r.bottom
    for (let y = r.top; y > r.top - 30; y -= 0.5) { if (document.elementFromPoint(x, y)?.closest('.md-quick-btn, .md-compare-btn') === b) top = y; else break }
    for (let y = r.bottom; y < r.bottom + 30; y += 0.5) { if (document.elementFromPoint(x, y)?.closest('.md-quick-btn, .md-compare-btn') === b) bottom = y; else break }
    // 8px above/below the visible edge resolve to this button or to something that is not another hero button
    const other = [r.top - 8, r.bottom + 8].map(y => {
      const t = document.elementFromPoint(x, y)?.closest('.md-quick-btn, .md-compare-btn')
      return t !== null && t !== undefined && t !== b
    })
    return { height: bottom - top, neighbourHit: other.some(Boolean) }
  })
  return { layout, hit, pageHeight: document.documentElement.scrollHeight }
})

for (const [width, minHit] of [[360, 43.5], [390, 43.5], [768, 43.5], [1440, 43.5], [320, 38]] as const) {
  test(`Mint Detail hero buttons have a ${minHit === 38 ? '≥38px (wrapped row)' : '44px'} touch target @ ${width}px`, async ({ browser }) => {
    const touch = await touchHero(browser, width, true)
    expect(await touch.page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const t = await heroHit(touch.page)
    await touch.ctx.close()
    expect(t.hit).toHaveLength(3)
    for (const [i, h] of t.hit.entries()) {
      expect(h.height, `button ${i} hit height`).toBeGreaterThanOrEqual(minHit)
      // (≤359px the wrapped Compare sits only 6px away, so a probe 8px out legitimately lands on it)
      if (width >= 360) expect(h.neighbourHit, `button ${i}: a point 8px away hits a neighbouring hero button`).toBe(false)
    }
    // visible boxes and page height identical to a mouse context
    const mouse = await touchHero(browser, width, false)
    const m = await heroHit(mouse.page)
    await mouse.ctx.close()
    expect(t.layout).toEqual(m.layout)
    expect(t.pageHeight).toBe(m.pageHeight)
    for (const h of m.hit) expect(h.height).toBeLessThan(35) // no extension without a coarse pointer
  })
}
