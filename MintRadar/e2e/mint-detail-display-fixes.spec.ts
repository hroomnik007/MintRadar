import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, probePayload, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// Display fixes from the data audit of 2026-10-25, with values of mint.lnpay.cz (offline, score 60): ongoing outage tiles,
// the stored score breakdown, last known MOTD/description, the History summary, Tor from the stored record, the
// "contacts not saved yet" line and the Compare input fee from the stored keysets.

const ALPHA = MOCK_MINTS[0]!.url
const H = 3_600_000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const LNPAY_BREAKDOWN = {
  uptime: { points: 0, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 15, max: 15 }, version: { points: 15, max: 15 },
  contact: { points: 5, max: 5 }, newMintCap: { points: 0, cap: 75 }, sum: 60,
}
const CHECKS = ['email', 'twitter', 'nostr'].map(kind => ({ kind, formatValid: true, domainResolves: kind === 'email' ? true : null, checkedAt: ago(40 * H) }))

interface Setup { known?: Record<string, unknown>; probe?: Record<string, unknown>; outages?: unknown; history?: unknown }

async function open(page: Page, s: Setup = {}) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, ...s.known } : m)) }))
  await page.route('**/api/mint/probe**', r => r.fulfill({ json: { ...probePayload(ALPHA), ...s.probe } }))
  if (s.outages) await page.route('**/api/mints/outages**', r => r.fulfill({ json: s.outages }))
  if (s.history) await page.route('**/api/mints/history**', r => r.fulfill({ json: s.history }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/mint/${encodeURIComponent(ALPHA)}`)
  await expect(page.locator('.md-tabs')).toBeVisible()
}

const OFFLINE = { online: false, latencyMs: null, info: null, keysets: null, error: 'Mint unreachable' }
const OFFLINE_KNOWN = { online: false, lastError: 'HTTP 502', reliabilityScore: 60, scoreBreakdown: LNPAY_BREAKDOWN, lastOnlineAt: ago(43 * H), offlineSince: ago(43 * H) }

test.describe('Mint Detail display fixes', () => {
  test('ongoing outage: "Down now" + duration, never "Since last outage"; error only on the ongoing row', async ({ page }) => {
    const outages = {
      sinceLastOutageMs: null, avgRecoveryMs: 30 * 60_000, outageCount: 2, recoveredCount: 1, ongoing: true,
      currentOutage: { startedAt: ago(43 * H), durationMs: 43 * H },
      outages: [
        { startedAt: ago(100 * H), durationMs: 30 * 60_000, error: 'offline', ongoing: false, truncatedAtWindowStart: false },
        { startedAt: ago(43 * H), durationMs: 43 * H, error: 'offline', ongoing: true, truncatedAtWindowStart: false },
      ],
    }
    await open(page, { known: OFFLINE_KNOWN, probe: OFFLINE, outages })
    await page.locator('.md-tab', { hasText: 'History' }).click()
    await expect(page.getByTestId('outage-tile-down')).toContainText('Down now')
    await expect(page.getByTestId('outage-tile-down').locator('.md-hist-fig-value')).not.toHaveText('—')
    await expect(page.getByTestId('outage-tile-recover')).toContainText('Time to recover (1 recovered)')
    await expect(page.getByTestId('outage-tile-since')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('Since last outage')
    await page.getByText('Show outage details').click()
    const ongoingRow = page.locator('tr[data-ongoing="true"]')
    await expect(ongoingRow).toContainText('(ongoing)')
    await expect(ongoingRow).toContainText('HTTP 502')
    const recovered = ongoingRow.locator('xpath=..').locator('tr:not([data-ongoing])')
    await expect(recovered).toHaveCount(1)
    await expect(recovered).toContainText('30 min')
    await expect(recovered).not.toContainText('HTTP 502')
    await expect(recovered).not.toContainText('offline')
  })

  test('score breakdown from the stored record: contact 5/5 while offline, rows sum to the shown 60', async ({ page }) => {
    await open(page, { known: OFFLINE_KNOWN, probe: { ...OFFLINE, contactChecks: CHECKS } })
    const panel = page.locator('.md-reliability-panel')
    await expect(panel.locator('.rb-row', { hasText: 'Contact' }).locator('.rb-row-score')).toHaveText('5/5')
    await expect(panel.locator('.rb-row', { hasText: 'Uptime' }).locator('.rb-row-score')).toHaveText('0/40')
    const scores = await panel.locator('.rb-row-score').allTextContents()
    expect(scores.reduce((a, t) => a + Number(t.split('/')[0]), 0)).toBe(60)
    await expect(panel.locator('.gauge-num')).toHaveText(/^60/)
  })

  test('offline: last known MOTD/description with a muted "last seen", pubkey from the stored record', async ({ page }) => {
    const pubkey = '025a3b7f' + 'cd'.repeat(29)
    await open(page, {
      known: { ...OFFLINE_KNOWN, pubkey },
      probe: { ...OFFLINE, lastInfo: { motd: 'Maintenance tonight', description: 'Czech test mint', seenAt: ago(43 * H) } },
    })
    await expect(page.getByTestId('info-lastseen')).toContainText('MOTD and description last seen')
    await expect(page.locator('body')).toContainText('Maintenance tonight')
    await expect(page.locator('body')).toContainText('Czech test mint')
    await expect(page.locator('body')).toContainText(pubkey.slice(0, 8))
  })

  test('online: live MOTD and no "last seen"', async ({ page }) => {
    await open(page, { probe: { lastInfo: { motd: 'old motd', description: 'old', seenAt: ago(H) } } })
    await expect(page.locator('body')).toContainText('Welcome to the test mint')
    await expect(page.getByTestId('info-lastseen')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('old motd')
  })

  test('History summary: average reliability of the segments, median / p95 latency', async ({ page }) => {
    const b = (h: number) => ago(h * H)
    const history = {
      period: '24h', uptimePct: 99, avgLatencyMs: 55, prevUptimePct: 98, prevAvgLatencyMs: 60, earliestCheckedAt: ago(30 * 24 * H),
      daysOfDataAvailable: 30, periodDays: 1, prevPeriodInsufficientHistory: false, p50LatencyMs: 48, p95LatencyMs: 210,
      segments: [
        { bucket: b(3), online: true, latencyMs: 50, total: 12, onlineCount: 12, uptimePct: 100, reliabilityScore: 80 },
        { bucket: b(2), online: true, latencyMs: 50, total: 12, onlineCount: 12, uptimePct: 100, reliabilityScore: 90 },
        { bucket: b(1), online: true, latencyMs: 50, total: 12, onlineCount: 12, uptimePct: 100, reliabilityScore: null },
      ],
      history: [{ online: true, latencyMs: 50, checkedAt: b(1) }],
    }
    await open(page, { history })
    await page.locator('.md-tab', { hasText: 'History' }).click()
    await expect(page.locator('.md-hist-fig', { hasText: 'Average reliability' }).locator('.md-hist-fig-value')).toHaveText('85')
    await expect(page.getByTestId('hist-latency-percentiles')).toHaveText('Median 48 ms · p95 210 ms')
  })

  test('Tor chip from the stored hasOnion while the mint is offline', async ({ page }) => {
    await open(page, { known: { ...OFFLINE_KNOWN, hasOnion: true }, probe: OFFLINE })
    await expect(page.locator('.md-url-tor')).toBeVisible()
  })

  test('no Tor chip without hasOnion', async ({ page }) => {
    await open(page, { known: { ...OFFLINE_KNOWN, hasOnion: false }, probe: OFFLINE })
    await expect(page.locator('.md-url-tor')).toHaveCount(0)
  })

  test('contact checks but no saved contact values: "Contacts not saved yet"', async ({ page }) => {
    await open(page, { known: OFFLINE_KNOWN, probe: { ...OFFLINE, contactChecks: CHECKS } })
    await expect(page.getByTestId('contacts-not-saved')).toHaveText('Contacts not saved yet; stored from the next successful check')
    await expect(page.getByTestId('contact-checks')).toBeVisible()
  })
})

test.describe('Compare: stored fallbacks and labels', () => {
  test('input fee from the stored keysets with "last checked"; Uptime 24h and Latency (last check) labels', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    const BRAVO = MOCK_MINTS[1]!.url
    await page.route('**/api/mints/known', r => r.fulfill({
      json: MOCK_KNOWN_MINTS.map((m, i) => (i === 0 ? { ...m, lastKeysets: [{ id: '00aa', unit: 'sat', active: true, inputFeePpk: 200 }], lastKeysetsCheckedAt: ago(2 * H) } : m)),
    }))
    await page.route('**/api/mint/probe**', r => {
      const target = new URL(r.request().url()).searchParams.get('url')
      r.fulfill({ json: target === ALPHA ? { ...probePayload(ALPHA), ...OFFLINE } : { ...probePayload(target ?? BRAVO), keysets: [{ id: '00bb', unit: 'sat', active: true, input_fee_ppk: 0 }] } })
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?status=all')
    await page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('button.card-compare-btn').click()
    await page.locator('.md-picker-item', { hasText: 'Bravo Mint' }).click()
    await page.locator('.md-picker-confirm').click()
    const grid = page.locator('.cmp-grid')
    await expect(grid).toBeVisible()
    const cells = grid.locator('.cmp-input-fee')
    await expect(cells.nth(0)).toContainText('200 ppk')
    await expect(cells.nth(0).locator('.cmp-fee-lastchecked')).toContainText('last checked 2h ago')
    await expect(cells.nth(1)).toContainText('free')
    await expect(cells.nth(1).locator('.cmp-fee-lastchecked')).toHaveCount(0)
    await expect(grid.locator('.cmp-lbl', { hasText: 'Uptime 24h' })).toHaveCount(1)
    await expect(grid.locator('.cmp-lbl', { hasText: 'Latency (last check)' })).toHaveCount(1)
  })
})
