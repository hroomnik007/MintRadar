import { test, expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, MOCK_KNOWN_MINTS, MOCK_MINTS } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'
import { auditCzResponse, FRESH_8333, NO_8333, gotoAuditTab } from './fixtures/auditCz'
import { METHODOLOGY_VERSION } from '../src/utils/methodology'
import { ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from '../src/utils/healthAssertionConstants'

// W5b: where the Reliability Score comes from (source · window · sample · time under every row), the "Limited data"
// label, the honest page for a mint that is not online, and the "Signed health record" row.

const ALPHA = MOCK_MINTS[0]!.url
const GONE = 'https://gone.mint.example'
const H = 3_600_000
const D = 24 * H
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
})

interface OpenOpts { width?: number; height?: number; probeOffline?: boolean; hash?: string }

async function open(page: Page, url: string, known: Record<string, unknown>, opts: OpenOpts = {}) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  const base = MOCK_KNOWN_MINTS[0]!
  const rows = MOCK_KNOWN_MINTS.some(m => m.url === url)
    ? MOCK_KNOWN_MINTS.map(m => (m.url === url ? { ...m, ...known } : m))
    : [...MOCK_KNOWN_MINTS, { ...base, url, name: 'Gone Mint', ...known }]
  await page.route('**/api/mints/known', route => route.fulfill({ json: rows }))
  if (opts.probeOffline) {
    await page.route('**/api/mint/probe**', route => route.fulfill({
      json: { url, online: false, latencyMs: null, info: null, keysets: null, checkedAt: new Date().toISOString(), error: 'Mint unreachable' },
    }))
  }
  await resize(page, opts.width ?? 1440, opts.height ?? 900)
  await page.goto(`/mint/${encodeURIComponent(url)}${opts.hash ?? ''}`)
  await layoutReady(page)
}

const rowOf = (page: Page, label: string) => page.locator('.md-reliability-panel .rb-row', { hasText: label })

test.describe('W5b A: source line under every score row', () => {
  test('healthy mint: source, window, sample and time on all five rows', async ({ page }) => {
    await open(page, ALPHA, { lastCheckedAt: ago(3 * 60_000) })
    const lines = page.locator('.md-reliability-panel .rb-row-source')
    await expect(lines).toHaveCount(5)
    await expect(lines.nth(0)).toHaveText('our probes from Nuremberg · 24 h · 12 checks · last probe 3 min ago')
    await expect(lines.nth(1)).toHaveText('cashu.info · 7 days · 100 swaps · synced 1h ago')
    await expect(lines.nth(2)).toHaveText('declared by the mint in /v1/info · fetched 3 min ago')
    await expect(lines.nth(3)).toHaveText('declared by the mint in /v1/info · compared with the newest stable release · fetched 3 min ago')
    await expect(lines.nth(4)).toHaveText('declared by the mint in /v1/info · fetched 3 min ago')
    // The absolute time is the title of the relative one.
    await expect(lines.nth(1).locator('span[title]')).toHaveAttribute('title', /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC$/)
  })

  test('neutral audit row says why instead of a swaps line', async ({ page }) => {
    await open(page, ALPHA, { auditCzTotal: 3, auditCzBlamed: 0 })
    await expect(rowOf(page, 'Audit reliability').locator('.rb-row-source')).toHaveText('cashu.info · 7 days · 3 swaps, fewer than 10 (neutral) · synced 1h ago')
  })

  test('score header links to the methodology with the real version', async ({ page }) => {
    await open(page, ALPHA, {})
    const link = page.locator('.md-reliability-panel').getByRole('link', { name: `Methodology v${METHODOLOGY_VERSION}` })
    await expect(link).toHaveAttribute('href', '/methodology')
  })

  test('Audit tab names the window the score uses and the one the tab shows', async ({ page }) => {
    await gotoAuditTab(page, { alpha: FRESH_8333, cz: auditCzResponse() })
    await expect(page.getByText("The Reliability Score uses cashu.info's last 7 days; this view shows audit.8333.space's last ~100 swaps.")).toBeVisible()
  })

  test('Audit tab, cashu.info view: no sentence under the heading, the window is in the ⓘ and the source line', async ({ page }) => {
    await gotoAuditTab(page, { alpha: NO_8333, cz: auditCzResponse() })
    await expect(page.getByTestId('audit-cz-source')).toBeVisible()
    await expect(page.getByText(/uses this same cashu\.info window/)).toHaveCount(0)
    await expect(page.getByText(/These rows are the same data split by direction/)).toHaveCount(0)
    await page.locator('.md-audit-header-main .md-audit-info').hover()
    await expect(page.getByRole('tooltip')).toContainText('The Reliability Score uses the combined cashu.info number for the last 7 days. Deposits and withdrawals are the same data split by direction.')
  })

  test('320 px: lines wrap inside the panel without clipping', async ({ page }) => {
    await open(page, ALPHA, {}, { width: 320, height: 640 })
    await page.locator('.md-sc-reliability').click()
    const lines = page.locator('.rb-modal .rb-row-source')
    await expect(lines).toHaveCount(5)
    for (let i = 0; i < 5; i++) {
      const box = await lines.nth(i).boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(320)
      expect(await lines.nth(i).evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      expect(await lines.nth(i).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12)
    }
  })
})

test.describe('W5b B: Limited data', () => {
  const label = (page: Page) => page.locator('.md-reliability-panel').getByRole('button', { name: 'Limited data' })

  test('absent for a mint with enough data', async ({ page }) => {
    await open(page, ALPHA, {})
    await expect(page.locator('.md-reliability-panel .gauge-num')).toBeVisible()
    await expect(label(page)).toHaveCount(0)
  })

  test('few swaps: label with the audit reason in its tooltip', async ({ page }) => {
    await open(page, ALPHA, { auditCzTotal: 4, auditCzBlamed: 0 })
    await label(page).click()
    await expect(page.getByRole('tooltip')).toHaveText('Audit based on fewer than 10 swaps.')
  })

  test('new mint: tooltip names the day count and the cap, together with the audit reason', async ({ page }) => {
    await open(page, ALPHA, { discoveredAt: ago(12 * D + H), auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null })
    await label(page).focus()
    await expect(page.getByRole('tooltip')).toHaveText('No recent audit data; tracked for 12 of 30 days, score capped at 75.')
  })

  test('the label is also in the breakdown dialog on a phone', async ({ page }) => {
    await open(page, ALPHA, { auditCzTotal: 4, auditCzBlamed: 0 }, { width: 390, height: 844 })
    await page.locator('.md-sc-reliability').click()
    await expect(page.locator('.rb-modal').getByRole('button', { name: 'Limited data' })).toBeVisible()
  })
})

const LONG_ERROR = `Connection failed ${'very-long-error-text '.repeat(150)} see https://evil.example/track?x=1`

const UNAVAILABLE = {
  offline: { online: false, degraded: false, archived: false, lastOnlineAt: ago(8 * D + 2 * H), offlineSince: ago(8 * D + H), lastError: LONG_ERROR, headline: /^Unavailable since \d{1,2} [A-Z][a-z]{2} \d{4} \(8 days\)$/ },
  degraded: { online: false, degraded: true, archived: false, lastOnlineAt: ago(5 * H), offlineSince: ago(5 * H - 600_000), lastError: LONG_ERROR, headline: /^Not responding since \d{1,2} [A-Z][a-z]{2} \d{4}$/ },
  archived: { online: false, degraded: true, archived: true, lastOnlineAt: ago(60 * D + 2 * H), offlineSince: ago(60 * D + H), lastError: LONG_ERROR, headline: /^Unavailable since \d{1,2} [A-Z][a-z]{2} \d{4} \(60 days\)$/ },
} as const

test.describe('W5b C: a mint that is not online', () => {
  for (const [name, c] of Object.entries(UNAVAILABLE)) {
    for (const width of [1440, 320]) {
      test(`${name} at ${width}px: since, last check, capped error, score caption, what to do, last keysets`, async ({ page }) => {
        const { headline, ...fields } = c
        await open(page, GONE, {
          ...fields, reliabilityScore: 61, latencyMs: null, nutCount: 3, nutsLimits: { '4': {}, '5': {}, '9': {} },
          lastCheckedAt: ago(4 * 60_000), lastKeysetsCheckedAt: ago(9 * D),
          lastKeysets: [{ id: '00ad268c4d1f5826', unit: 'sat', active: true, inputFeePpk: 100 }, { id: '00c074b96c7e2b0e', unit: 'sat', active: false, inputFeePpk: 0 }],
        }, { width, height: width === 320 ? 640 : 900, probeOffline: true })
        const block = page.locator('.md-unavailable')
        await expect(block).toBeVisible()
        await expect(block.locator('.md-ua-headline')).toHaveText(headline)
        if (name === 'degraded') await expect(block).not.toContainText(/archiv/i)
        await expect(block).toContainText('Last check 4 min ago')
        const err = (await block.locator('.md-ua-line', { hasText: 'Last error:' }).innerText()).replace('Last error: ', '')
        expect(err.length).toBeLessThanOrEqual(120)
        expect(err).not.toMatch(/https?:|evil\.example/)
        if (width === 1440) await expect(page.locator('.md-reliability-panel')).toContainText('Last measured score. Measurements from this mint are not current.')
        else await expect(block).toContainText('Reliability Score 61. Last measured score. Measurements from this mint are not current.')
        await expect(block).toContainText('What to do with tokens from an unreachable mint')
        await expect(block).toContainText('Keep your wallet and your seed phrase.')
        await expect(block).toContainText('This mint listed NUT-09 at its last check')
        await expect(block.getByRole('link', { name: 'Read about the risks of using a mint' })).toHaveAttribute('href', '/learn/understanding-the-risks')
        await expect(block).not.toContainText(/\b(dead|scam|safe|recommended)\b/i)
        // Last known keysets instead of "Keyset data not available".
        const keysets = width === 1440 ? page.locator('.md-keysets-at-overview') : page.locator('.md-keysets-at-nuts')
        if (width !== 1440) await page.locator('.md-tab', { hasText: 'NUTs' }).click()
        // One active, one inactive keyset: the active one shows, the inactive one is behind the button.
        await expect(keysets.locator('.md-keyset-row')).toHaveCount(1)
        await keysets.getByRole('button', { name: 'Show 1 inactive keyset' }).click()
        await expect(keysets.locator('.md-keyset-row')).toHaveCount(2)
        await expect(keysets).toContainText(/from the last successful check on \d{1,2} [A-Z][a-z]{2} \d{4}/)
        await expect(keysets).not.toContainText('Keyset data not available')
        // No horizontal overflow, whatever the error text.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      })
    }
  }

  test('an online mint has no unavailable block', async ({ page }) => {
    await open(page, ALPHA, {})
    await expect(page.locator('.md-reliability-panel')).toBeVisible()
    await expect(page.locator('.md-unavailable')).toHaveCount(0)
  })

  test('without a stored keyset check the old text stays', async ({ page }) => {
    await open(page, GONE, { ...UNAVAILABLE.offline, lastKeysets: [], lastKeysetsCheckedAt: null, lastError: 'Mint unreachable' }, { probeOffline: true })
    await expect(page.locator('.md-keysets-at-overview')).toContainText('Keyset data not available.')
  })
})

test.describe('W5b D: Signed health record', () => {
  test('View on Nostr opens njump.me in a new tab, Copy naddr holds the naddr, the link goes to /for-wallets', async ({ page }) => {
    await open(page, ALPHA, {})
    const row = page.locator('.md-hr-row')
    await expect(row.locator('.md-info-label')).toHaveText('Signed health record')
    await row.getByRole('button', { name: /Nostr address \(naddr\)/ }).click()
    const naddr = await page.evaluate(() => navigator.clipboard.readText())
    const dec = nip19.decode(naddr)
    expect(dec.type).toBe('naddr')
    const d = dec.data as nip19.AddressPointer
    expect(d).toMatchObject({ kind: 30385, pubkey: ATTESTATION_PUBKEY_HEX, identifier: ALPHA, relays: [...ATTESTATION_RELAYS_PUBLIC] })
    await expect(row.getByRole('button', { name: /Nostr address \(naddr\)/ })).toContainText('Copied')
    const view = row.getByRole('link', { name: /View on Nostr/ })
    await expect(view).toHaveText('View on Nostr')
    await expect(view).toHaveAttribute('href', `https://njump.me/${naddr}`)
    await expect(view).toHaveAttribute('target', '_blank')
    await expect(view).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(view).toHaveAttribute('aria-label', /njump\.me.*external site.*new tab/)
    await expect(row.getByRole('link', { name: 'About signed health records' })).toHaveAttribute('href', '/for-wallets#signed-health-assertions')
  })

  test('the nak command lives in a collapsed "For developers" disclosure: relay, copy button, the note with a link; keyboard opens it', async ({ page }) => {
    await open(page, ALPHA, {})
    const row = page.locator('.md-hr-row')
    const dev = row.locator('details.md-hr-dev')
    const nak = row.getByRole('button', { name: /nak command/ })
    // collapsed by default: the button is in the DOM inside the disclosure, and not visible; nothing of it outside
    await expect(dev).toHaveCount(1)
    expect(await dev.evaluate(el => (el as HTMLDetailsElement).open)).toBe(false)
    await expect(nak).toBeHidden()
    await expect(row.locator(':scope > .md-hr-value').getByRole('button', { name: /nak command/ })).toHaveCount(0)
    await expect(dev.locator('summary')).toHaveText('For developers')
    // keyboard: focus the summary, Enter opens it
    await dev.locator('summary').focus()
    await page.keyboard.press('Enter')
    expect(await dev.evaluate(el => (el as HTMLDetailsElement).open)).toBe(true)
    await expect(dev.locator('.md-hr-dev-relay code')).toHaveText(ATTESTATION_RELAYS_PUBLIC[0])
    await expect(dev.locator('.md-hr-dev-note')).toHaveText('Requires the nak command-line tool (github.com/fiatjaf/nak).')
    const link = dev.locator('.md-hr-dev-note a')
    await expect(link).toHaveText('github.com/fiatjaf/nak')
    await expect(link).toHaveAttribute('href', 'https://github.com/fiatjaf/nak')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(nak).toBeVisible()
    await nak.click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`nak req -k 30385 -a ${ATTESTATION_PUBKEY_HEX} -d '${ALPHA}' ${ATTESTATION_RELAYS_PUBLIC.join(' ')}`)
    await dev.locator('summary').focus()
    await page.keyboard.press('Space')
    expect(await dev.evaluate(el => (el as HTMLDetailsElement).open)).toBe(false)
  })

  test('an archived mint shows "No current record" and the same link', async ({ page }) => {
    await open(page, GONE, UNAVAILABLE.archived, { probeOffline: true })
    const row = page.locator('.md-hr-row')
    await expect(row).toContainText('No current record')
    await expect(row.getByRole('button')).toHaveCount(0)
    // no naddr, no link: no njump link and no disclosure
    await expect(row.getByRole('link', { name: /View on Nostr/ })).toHaveCount(0)
    await expect(row.locator('a[href*="njump.me"]')).toHaveCount(0)
    await expect(row.locator('details')).toHaveCount(0)
    await expect(row.getByRole('link', { name: 'About signed health records' })).toBeVisible()
  })

  for (const width of [390, 320]) {
    test(`${width} px: the row and the opened disclosure stay inside the viewport, text at least 12px, targets at least as large as before`, async ({ page }) => {
      await open(page, ALPHA, {}, { width, height: 844 })
      const row = page.locator('.md-hr-row')
      await row.locator('summary').click()
      await expect(row.getByRole('button', { name: /nak command/ })).toBeVisible()
      const m = await row.evaluate((el, vw) => {
        const out: string[] = []
        for (const n of el.querySelectorAll<HTMLElement>('*')) {
          const r = n.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.right > vw + 0.5 || r.left < -0.5) out.push(`${n.className || n.tagName} outside`)
          if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'visible') out.push(`${n.className || n.tagName} clipped`)
          if ([...n.childNodes].some(c => c.nodeType === 3 && (c.textContent ?? '').trim()) && parseFloat(getComputedStyle(n).fontSize) < 12) out.push(`${n.className || n.tagName} below 12px`)
        }
        const h = (sel: string) => el.querySelector<HTMLElement>(sel)?.getBoundingClientRect().height ?? 0
        return { out, view: h('.md-hr-view'), summary: h('summary'), copy: h('.doc-copy-btn') }
      }, width)
      expect(m.out).toEqual([])
      // the new controls are at least as tall as the existing copy buttons (they set the row's target size today)
      expect(m.copy).toBeGreaterThan(0)
      expect(m.view, '"View on Nostr" is exactly as tall as "Copy naddr"').toBe(m.copy)
      expect(m.summary).toBeGreaterThanOrEqual(m.copy)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }
})
