import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { resize } from './fixtures/settle'

type Json = Record<string, unknown>

async function knownMints(page: import('@playwright/test').Page, rows: Json[]) {
  await page.route('**/api/mints/known', r => r.fulfill({ json: rows }))
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1600 })
  await mockRelays(page)
  await installApiMocks(page)
})

test('Uptime tab list excludes test mints; Reliability tab also excludes them (audit run-3)', async ({ page }) => {
  const base = MOCK_KNOWN_MINTS[0]!
  // Uptime tab ranks by uptimePct7d (2026-09-19), not uptimePct24h — see
  // docs/claude/discovery-and-relays.md's "Most Reliable panel — 7-day default window" note. uptimePct24h is
  // still set here too since other parts of the page (avg-uptime hero tile) read it.
  const rows: Json[] = [
    { ...base, url: 'https://testnut.cashu.space', name: 'Testnut', online: true, uptimePct24h: 100, uptimePct7d: 100, reliabilityScore: 99 },
    { ...MOCK_KNOWN_MINTS[1], online: true, uptimePct24h: 97, uptimePct7d: 97, reliabilityScore: 70 },
    { ...MOCK_KNOWN_MINTS[3], online: true, uptimePct24h: 95, uptimePct7d: 95, reliabilityScore: 78 },
  ]
  await knownMints(page, rows)
  await page.goto('/stats')

  // The Uptime/Reliability widget (its title changes with the tab, so locate it by
  // the toggle instead).
  const widget = page.locator('.stats-panel').filter({ has: page.getByRole('button', { name: 'Uptime', exact: true }) })
  await expect(widget.locator('.stats-top5-row').first()).toBeVisible()
  // Uptime tab: the 100%-uptime test mint is filtered out.
  await expect(widget.locator('.stats-top5-row', { hasText: 'Testnut' })).toHaveCount(0)

  // Reliability tab: also excludes it, as of the 2026-09-19 audit run-3 fix that
  // closed this gap (top5ByReliability previously had no test-mint exclusion at
  // all, unlike top5ByUptime and the backend's own top5ByReliabilityScore).
  await widget.getByRole('button', { name: 'Reliability', exact: true }).click()
  await expect(widget.locator('.stats-top5-row', { hasText: 'Testnut' })).toHaveCount(0)
})

test('Uptime and Reliability tabs leave out an "online" mint whose newest probe is older than 3 hours', async ({ page }) => {
  const stale = new Date(Date.now() - 5 * 3_600_000).toISOString()
  // Old enough for the 14-day recommendation age gate, so only the probe age can keep the first one out.
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString()
  await knownMints(page, [
    { ...MOCK_KNOWN_MINTS[1], name: 'Zulu Mint', online: true, discoveredAt: old, lastCheckedAt: stale, uptimePct24h: 100, uptimePct7d: 100, reliabilityScore: 99 },
    { ...MOCK_KNOWN_MINTS[3], name: 'Yankee Mint', online: true, discoveredAt: old, uptimePct24h: 95, uptimePct7d: 95, reliabilityScore: 78 },
  ])
  await page.goto('/stats')
  const widget = page.locator('.stats-panel').filter({ has: page.getByRole('button', { name: 'Uptime', exact: true }) })
  await expect(widget.locator('.stats-top5-row', { hasText: 'Yankee Mint' })).toBeVisible()
  await expect(widget.locator('.stats-top5-row', { hasText: 'Zulu Mint' })).toHaveCount(0)
  await widget.getByRole('button', { name: 'Reliability', exact: true }).click()
  await expect(widget.locator('.stats-top5-row', { hasText: 'Yankee Mint' })).toBeVisible()
  await expect(widget.locator('.stats-top5-row', { hasText: 'Zulu Mint' })).toHaveCount(0)
})

test('Uptime tab rows never show a hostname/URL subtitle under the name', async ({ page }) => {
  const base = MOCK_KNOWN_MINTS[0]!
  await knownMints(page, [
    // name differs from the hostname — the subtitle used to render here.
    { ...base, url: 'https://alpha.example', name: 'Alpha Mint', online: true, uptimePct24h: 98, uptimePct7d: 98, reliabilityScore: 80 },
  ])
  await page.goto('/stats')

  const row = page.locator('.stats-panel').filter({ has: page.getByRole('button', { name: 'Uptime', exact: true }) }).locator('.stats-top5-row').first()
  await expect(row).toBeVisible()
  const text = (await row.textContent()) ?? ''
  expect(text).toContain('Alpha Mint')
  // The hostname is not rendered anywhere in the row.
  expect(text).not.toContain('alpha.example')
})

test('Uptime tab (after a click) is labeled 7D and ranks by uptimePct7d, not uptimePct24h', async ({ page }) => {
  const base = MOCK_KNOWN_MINTS[0]!
  // Deliberately opposite orderings on the two fields — Bravo has the higher
  // 24h uptime but the lower 7d uptime; if the panel were still reading
  // uptimePct24h it would rank Bravo first instead of Alpha.
  await knownMints(page, [
    { ...base, url: 'https://alpha.example', name: 'Alpha Mint', online: true, uptimePct24h: 80, uptimePct7d: 99, reliabilityScore: 80 },
    { ...base, url: 'https://bravo.example', name: 'Bravo Mint', online: true, uptimePct24h: 100, uptimePct7d: 60, reliabilityScore: 70 },
  ])
  await page.goto('/stats')

  const widget = page.locator('.stats-panel').filter({ has: page.getByRole('button', { name: 'Uptime', exact: true }) })
  // The panel opens on Reliability (default since 2026-10-07); Uptime is one click away.
  await expect(widget).toContainText('Top by Reliability Score')
  await widget.getByRole('button', { name: 'Uptime', exact: true }).click()
  await expect(widget).toContainText('Top uptime')
  await expect(widget).not.toContainText('Top uptime · 24H')

  const firstRow = widget.locator('.stats-top5-row').first()
  await expect(firstRow).toContainText('Alpha Mint')
  await expect(firstRow).toContainText('99%')
})

test('Geographic Distribution buckets CDN / cloud / anycast labels into one row', async ({ page }) => {
  const base = MOCK_KNOWN_MINTS[0]!
  await knownMints(page, [
    { ...base, url: 'https://a.example', name: 'A', online: true, serverLocation: 'Cloudflare CDN' },
    { ...base, url: 'https://b.example', name: 'B', online: true, serverLocation: 'AWS us-east-1' },
    { ...base, url: 'https://c.example', name: 'C', online: true, serverLocation: 'anycast' },
    { ...base, url: 'https://d.example', name: 'D', online: true, serverLocation: 'Frankfurt, DE' },
    { ...base, url: 'https://e.example', name: 'E', online: true, serverLocation: 'Frankfurt, DE' },
  ])
  await page.goto('/stats')

  const geo = page.locator('.stats-panel', { hasText: 'Geographic Distribution' })
  const cdnRow = geo.locator('.dist-row', { hasText: 'CDN / anycast' })
  await expect(cdnRow).toHaveCount(1)
  await expect(cdnRow.locator('.dist-count')).toHaveText('3')
  await expect(geo.locator('.dist-row', { hasText: 'Cloudflare' })).toHaveCount(0)
})

test('Geographic distribution: the CDN / anycast explanation is a visible sentence in its modal, not a title', async ({ page }) => {
  const base = MOCK_KNOWN_MINTS[0]!
  await knownMints(page, ['Cloudflare CDN', 'anycast', 'Linz, AT'].map((serverLocation, i) => ({ ...base, url: `https://h${i}.example`, name: `H${i}`, online: true, serverLocation })))
  await page.goto('/stats')
  await page.locator('.stats-geo-cdn').click()
  await expect(page.locator('.nut-modal .nut-modal-note').first()).toHaveText('CDN / anycast addresses are not a city')
  await expect(page.locator('.nut-modal-footer')).toHaveText(/^2 online\s*Sorted by Reliability Score$/)
})

test('Geographic distribution: description, CDN / anycast as the last cell of the city grid, balanced columns, rows still open the modal', async ({ page }) => {
  const base = MOCK_KNOWN_MINTS[0]!
  const locs = ['Cloudflare CDN', 'Cloudflare CDN', 'Frankfurt am Main, DE', 'Frankfurt am Main, DE', 'Linz, AT', 'Tokyo, JP', 'Boston, US']
  await knownMints(page, locs.map((serverLocation, i) => ({ ...base, url: `https://g${i}.example`, name: `G${i}`, online: true, serverLocation })))
  await page.goto('/stats')

  const geo = page.locator('.stats-panel', { hasText: 'Geographic Distribution' })
  await expect(geo.locator('.stats-panel-desc')).toHaveText('City from the IP address, not where the operator is.')
  const cdn = geo.locator('.stats-geo-cdn')
  await expect(cdn).toHaveCount(1)
  await expect(cdn.locator('.dist-label')).toHaveText('CDN / anycast')
  await expect(cdn.locator('.dist-count')).toHaveText('2')
  await expect(cdn, 'the explanation is not a title attribute').not.toHaveAttribute('title', /.+/)
  // The bucket sits in the same list as the cities, in the last cell: 4 cities + the bucket.
  const cells = geo.locator('.stats-geo-cols .dist-row')
  await expect(cells).toHaveCount(5)
  await expect(cells.last()).toHaveClass(/stats-geo-cdn/)
  const lefts = () => cells.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().left)))
  const tops = () => cells.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)))
  // From 1280 px the card is the narrow third column of the board: ONE list, every cell under the previous one, in DOM order.
  expect(page.viewportSize()!.width).toBeGreaterThanOrEqual(1280)
  expect(new Set(await lefts()).size, 'one column from 1280 px').toBe(1)
  const listTops = await tops()
  expect(listTops, 'cells follow each other downwards').toEqual([...listTops].sort((a, b) => a - b))
  expect(new Set(listTops).size, 'no two cells on the same row').toBe(5)
  // Below 1280 px (here 1000) the cities go back to two balanced columns: 3 + 2, the bucket last.
  await resize(page, 1000, 900)
  const narrow = await lefts()
  expect(new Set(narrow).size, 'two columns below 1280 px').toBe(2)
  expect(narrow.filter(x => x === Math.min(...narrow)).length, 'balanced columns, 3 + 2').toBe(3)
  await resize(page, 1280, 720)
  // No underline any more, the flag has its own cell, the row is still clickable.
  const row = geo.locator('.stats-geo-cols .dist-row', { hasText: 'Frankfurt' })
  await expect(row.locator('.stats-geo-flag')).toHaveText('🇩🇪')
  expect(await row.locator('.dist-label').evaluate(e => getComputedStyle(e).textDecorationLine)).toBe('none')
  await row.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await cdn.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('Software panel: "% of tracked mints running outdated software" + explanatory (i)', async ({ page }) => {
  // Fixture latest = Nutshell 0.20: 0.20.0 current, 0.19.0 one behind (NOT outdated), 0.18.0 and 0.16.0 two or more behind.
  await knownMints(page, [
    { ...MOCK_KNOWN_MINTS[0], online: true, version: 'Nutshell/0.20.0' },
    { ...MOCK_KNOWN_MINTS[1], online: true, version: 'Nutshell/0.19.0' },
    { ...MOCK_KNOWN_MINTS[2], online: true, version: 'Nutshell/0.18.0' },
    { ...MOCK_KNOWN_MINTS[3], online: true, version: 'Nutshell/0.16.0' },
  ])
  await page.goto('/stats')

  const sw = page.locator('.stats-now-panel')
  await expect(sw.getByText('Tracked mints running outdated software')).toBeVisible()
  await expect(sw.getByText('Tracked mints behind the latest release')).toHaveCount(0)
  await expect(sw.getByText('Behind current release')).toHaveCount(0)
  await expect(sw.getByText('Running outdated or older versions')).toHaveCount(0)
  // 2 of the 4 classifiable mints are two or more minor versions behind
  await expect(sw.locator('.stats-now-behind')).toContainText('50%')

  await sw.locator('.stats-sw-behind-info').hover()
  await expect(page.getByRole('tooltip').filter({ hasText: /two or more minor versions behind the newest stable release/i })).toBeVisible()
})

test('Software panel: the share counts only Nutshell / cdk-mintd mints and never a one-behind or pre-release mint', async ({ page }) => {
  await knownMints(page, [
    { ...MOCK_KNOWN_MINTS[0], online: true, version: 'cdk-mintd/0.18.0-rc.1', softwareLatest: { major: 0, minor: 18 } },
    { ...MOCK_KNOWN_MINTS[1], online: true, version: 'cdk-mintd/0.17.7', softwareLatest: { major: 0, minor: 18 } },
    { ...MOCK_KNOWN_MINTS[2], online: true, version: 'LekMint/1.1.1', softwareLatest: null },
    { ...MOCK_KNOWN_MINTS[3], online: true, version: 'cdk-mintd/0.15.1', softwareLatest: { major: 0, minor: 18 } },
  ])
  await page.goto('/stats')
  // 1 outdated (0.15.1) of the 3 cdk-mintd mints; the unknown software is not in the denominator
  await expect(page.locator('.stats-now-panel .stats-now-behind')).toContainText('33%')
})

// The outdated-software row is a boxed amber row at every width, with the same declarations as on desktop
// (it used to be boxed from 1280 px only). At 320 px the label wraps and the content must stay inside the box.
test('Software panel: the outdated-software row keeps the same box on phones as on desktop', async ({ page }) => {
  await knownMints(page, [
    { ...MOCK_KNOWN_MINTS[0], online: true, version: 'Nutshell/0.20.0' },
    { ...MOCK_KNOWN_MINTS[1], online: true, version: 'Nutshell/0.19.0' },
    { ...MOCK_KNOWN_MINTS[2], online: true, version: 'Nutshell/0.18.0' },
    { ...MOCK_KNOWN_MINTS[3], online: true, version: 'Nutshell/0.16.0' },
  ])
  const box = async (width: number, height: number) => {
    await page.setViewportSize({ width, height })
    await page.goto('/stats')
    const row = page.locator('.stats-now-behind > div')
    await expect(row).toBeVisible()
    return row.evaluate(el => {
      const cs = getComputedStyle(el)
      return {
        borderWidth: cs.borderTopWidth, borderStyle: cs.borderTopStyle, borderColor: cs.borderTopColor,
        background: cs.backgroundColor, radius: cs.borderTopLeftRadius, padding: cs.padding,
        fits: el.scrollWidth <= el.clientWidth,
      }
    })
  }
  const desktop = await box(1440, 900)
  expect(desktop.borderWidth).toBe('1px')
  expect(desktop.fits).toBe(true)
  for (const [width, height] of [[390, 844], [320, 640]] as const) {
    expect(await box(width, height), `row box at ${width}px`).toEqual(desktop)
  }
})

for (const width of [901, 1024, 1140, 1280, 1440, 1920, 390]) {
  test(`Stats hero tile notes stay inside their tiles at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/stats')
    await expect(page.locator('.stats-metrics .stat-card').first()).toBeVisible()
    const overflow = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.stats-metrics .stat-card')]
      return tiles.some(tile => {
        const tr = tile.getBoundingClientRect()
        return [...tile.querySelectorAll('.stat-note, .stat-value, .stat-unit')].some(el => {
          const r = el.getBoundingClientRect()
          return r.right > tr.right + 1
        })
      })
    })
    expect(overflow).toBe(false)
  })
}

// 320 px: the two city columns leave the label ~54 px; "Germany" used to break as "German / y". A word never breaks
// inside (a line break is fine at a space).
test('Geographic distribution at 320 px: no city name breaks inside a word', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const base = MOCK_KNOWN_MINTS[0]!
  const locs = ['Germany', 'Germany', 'Netherlands', 'Singapore', 'San Francisco, US', 'Kuala Lumpur, MY', 'Frankfurt am Main, DE', 'Linz, AT', 'Tokyo, JP']
  await knownMints(page, locs.map((serverLocation, i) => ({ ...base, url: `https://g${i}.example`, name: `G${i}`, online: true, serverLocation })))
  await page.goto('/stats')

  const geo = page.locator('.stats-panel', { hasText: 'Geographic Distribution' })
  const labels = geo.locator('.stats-geo-cols .dist-label-city')
  await expect(labels.first()).toBeVisible()
  const broken = await labels.evaluateAll(els => els.flatMap(el => {
    const text = el.firstChild as Text
    const out: string[] = []
    for (const m of (text.data).matchAll(/\S+/g)) {
      const range = document.createRange()
      range.setStart(text, m.index!)
      range.setEnd(text, m.index! + m[0].length)
      const lines = new Set(Array.from(range.getClientRects()).map(r => Math.round(r.top)))
      if (lines.size > 1) out.push(m[0])
    }
    return out
  }))
  expect(broken, 'words that wrap inside the word').toEqual([])
  // A one-word name takes exactly one line: as tall as "Tokyo", which always fits.
  const height = (name: RegExp) => geo.locator('.stats-geo-cols .dist-label-city', { hasText: name }).evaluate(e => e.getBoundingClientRect().height)
  const oneLine = await height(/^Tokyo$/)
  for (const name of [/^Germany$/, /^Netherlands$/, /^Singapore$/]) expect(await height(name), `${name} on one line`).toBe(oneLine)
})
