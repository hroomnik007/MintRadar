import { test, expect, type Page } from '@playwright/test'
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { flush, layoutReady, networkQuiet, resize, trackRequests } from './fixtures/settle'

// Payment request inspector (NUT-18) on /tools: src/components/PaymentRequestInspector.tsx, src/utils/paymentRequest.ts.
// The pasted string is decoded in the browser; nothing is requested for it.

const KNOWN = MOCK_MINTS[0]!.url // Alpha Mint: online, Reliability 92
const UNKNOWN = 'https://stranger.mint.example'
const NPROFILE = 'nprofile1qqsw3dy8cpumpn0xxwk5ahpfd7q0adz5qp8ev0kdpynqkmq5aq7mdgc'
const POST_URL = 'https://pay.example.com/callback/abc'
const LOCK_KEY = '02' + 'ab'.repeat(32)

function encode(opts: { mints?: string[]; amount?: number; description?: string; transports?: { type: PaymentRequestTransportType; target: string }[]; lock?: boolean; id?: string } = {}): string {
  return new PaymentRequest(
    opts.transports,
    opts.id ?? 'req-42',
    opts.amount,
    opts.amount === undefined ? undefined : 'sat',
    opts.mints ?? [KNOWN, UNKNOWN],
    opts.description,
    false,
    opts.lock ? { kind: 'P2PK', data: LOCK_KEY, tags: [['locktime', '1700000000']] } : undefined,
  ).toEncodedCreqA()
}

// NUT-26 example, copied from the spec text (nuts/26.md): id demo123, 1000 sat, single use, one mint, "Coffee payment".
const NUT26_EXAMPLE = 'CREQB1QYQQWER9D4HNZV3NQGQQSQQQQQQQQQQRAQPSQQGQQSQQZQG9QQVXSAR5WPEN5TE0D45KUAPWV4UXZMTSD3JJUCM0D5RQQRJRDANXVET9YPCXZ7TDV4H8GXHR3TQ'
// Requests with the NUT-18 mint-list flag `mp` and the supported methods `sm` / `mf`, which cashu-ts cannot encode or decode
// (built by hand; "Alpha Mint" is the tracked mint of the mocks). A_MP_SM = id ext-1, 21 sat, mp true, bolt11 and onchain with mf 50;
// B_MP_SM is the same request as creqB (TLV tags 0x09 and 0x0a), in upper case as a QR code carries it.
const A_MP_SM = 'creqApmFpZWV4dC0xYWEVYXVjc2F0YW2BeBpodHRwczovL2FscGhhLm1pbnQuZXhhbXBsZWJtcPVic22CoWJtbmZib2x0MTGiYm1uZ29uY2hhaW5ibWYYMg'
const A_MP_FALSE = 'creqAo2FpZWV4dC0yYW2BeBpodHRwczovL2FscGhhLm1pbnQuZXhhbXBsZWJtcPQ'
const A_SM_STRICT = 'creqAo2FpZWV4dC00YW2BeBpodHRwczovL2FscGhhLm1pbnQuZXhhbXBsZWJzbYKhYm1uZmJvbHQxMaJibW5nb25jaGFpbmJtZhgy'
const A_SM_NO_MINTS = 'creqAo2FpZWV4dC01YXVjc2F0YnNtgaJibW5nb25jaGFpbmJtZhgy'
const A_MP_NO_MINTS = 'creqAomFpZWV4dC0zYm1w9Q'
const B_MP_SM = 'CREQB1QYQQ2ETCWSKNZQSQPQQQQQQQQQQQQ9GRQQQSQPGQRF58GARSWVAZ7TMPD3CXSCFWD45KUAPWV4UXZMTSD3JSJQQPQY9QQZGPQQRXYMMVWSCNZZSQZ5QSQPM0DE3KSCTFDCPQQZQQQQQQQQQQQQEQ4HJCD4'
const MINT_PREFERRED = 'Mint list: preferred (ecash from other mints is accepted too).'
const MINT_STRICT = 'Mint list: strict (only ecash from these mints is accepted).'
const STRICT_LIST_NOTE = 'Because the mint list is strict, this fee does not apply.'
const OTHER_MINTS_NOTE = 'A fee applies only to ecash from a mint outside the accepted mints list, or from any mint if no list is given. The payer owes the lowest fee among the listed methods its mint supports.'
const PREFIX_ERROR = 'Not a payment request: expected a string starting with creqA or creqB.'

const card = (page: Page) => page.getByTestId('payment-request-inspector')
const input = (page: Page) => card(page).getByRole('textbox', { name: 'Payment request' })
const result = (page: Page) => card(page).getByTestId('pr-result')
const errorBox = (page: Page) => card(page).getByTestId('pr-error')

async function open(page: Page, size: [number, number] = [1440, 900]) {
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, size[0], size[1])
  await page.goto('/tools')
  await expect(card(page)).toBeVisible()
}

test('a valid request: plain facts, a known mint with its name, status and Reliability Score, an unknown one without judgement', async ({ page }) => {
  await open(page)
  await input(page).fill(encode({ amount: 21, description: 'Coffee', lock: true }))
  await expect(result(page)).toBeVisible()
  await expect(result(page)).toContainText('req-42')
  await expect(page.getByTestId('pr-amount')).toContainText('21')
  await expect(result(page)).toContainText('Coffee')
  await expect(page.getByTestId('pr-lock')).toContainText('P2PK')
  await expect(page.getByTestId('pr-lock')).toContainText(LOCK_KEY)
  await expect(page.getByTestId('pr-lock')).toContainText('locktime: 1700000000')

  const mints = result(page).getByTestId('pr-mint')
  await expect(mints).toHaveCount(2)
  await expect(mints.nth(0)).toContainText('Alpha Mint')
  await expect(mints.nth(0).getByTestId('pr-mint-status')).toHaveText('Online')
  await expect(mints.nth(0)).toContainText('Reliability 92')
  await expect(mints.nth(0).getByRole('link', { name: 'View Mint Detail' })).toHaveAttribute('href', `/mint/${encodeURIComponent(KNOWN)}`)
  await expect(mints.nth(1)).toContainText(UNKNOWN)
  await expect(mints.nth(1)).toContainText('Not tracked by MintRadar.')
  await expect(mints.nth(1).getByTestId('pr-mint-status')).toHaveCount(0)
  await expect(mints.nth(1)).not.toContainText(/Online|Offline|Reliability/)
  await expect(mints.nth(1).getByRole('link')).toHaveCount(0)
})

test('a request without mints is valid: "No mints specified" instead of an error', async ({ page }) => {
  await open(page)
  await input(page).fill(new PaymentRequest(undefined, 'x', 1, 'sat', undefined).toEncodedCreqA())
  await expect(errorBox(page)).toHaveCount(0)
  await expect(result(page)).toBeVisible()
  await expect(result(page).getByTestId('pr-no-mints')).toHaveText('No mints specified')
  await expect(result(page).getByTestId('pr-mint')).toHaveCount(0)
  await expect(page.getByTestId('pr-amount')).toContainText('1')
})

test('a request with nothing in it at all shows "Not specified" everywhere and is still valid', async ({ page }) => {
  await open(page)
  await input(page).fill(new PaymentRequest().toEncodedCreqA())
  await expect(errorBox(page)).toHaveCount(0)
  await expect(result(page)).toBeVisible()
  await expect(result(page).getByTestId('pr-no-mints')).toHaveText('No mints specified')
  await expect(result(page).locator('.pr-value')).toHaveText(Array(6).fill('Not specified'))
  await expect(result(page).getByText('Transports')).toBeVisible()
  await expect(result(page).getByTestId('pr-no-transports')).toHaveText('None listed: the payment is returned directly (in-band)')
  await expect(result(page).locator('.pr-note', { hasText: 'Not specified' })).toHaveCount(0)
})

test('amount absent reads "Not specified"; nothing else is invented', async ({ page }) => {
  await open(page)
  await input(page).fill(encode())
  await expect(page.getByTestId('pr-amount')).toHaveText(/Not specified/)
  await expect(page.getByTestId('pr-lock')).toHaveText(/Not specified/)
  await expect(result(page)).not.toContainText(/safe|trusted|recommended|scam|dead/i)
})

test('a mint is matched after URL normalisation (upper-case host, trailing slash)', async ({ page }) => {
  await open(page)
  await input(page).fill(encode({ mints: ['HTTPS://ALPHA.MINT.EXAMPLE/'] }))
  const mint = result(page).getByTestId('pr-mint')
  await expect(mint).toContainText('Alpha Mint')
  await expect(mint).not.toContainText('Not tracked')
})

test('nostr and post transports: targets are plain text with a copy button, never links', async ({ page }) => {
  await open(page)
  await input(page).fill(encode({ transports: [
    { type: PaymentRequestTransportType.NOSTR, target: NPROFILE },
    { type: PaymentRequestTransportType.POST, target: POST_URL },
  ] }))
  const rows = result(page).getByTestId('pr-transport')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('nostr')
  await expect(rows.nth(0).getByTestId('pr-transport-target')).toHaveText(NPROFILE)
  await expect(rows.nth(1)).toContainText('post')
  await expect(rows.nth(1).getByTestId('pr-transport-target')).toHaveText(POST_URL)
  await expect(rows.locator('a')).toHaveCount(0)
  await expect(rows.nth(0).getByRole('button', { name: 'Copy: nostr transport target' })).toBeVisible()
  await expect(rows.nth(1).getByRole('button', { name: 'Copy: post transport target' })).toBeVisible()
  // The only links in the result are the "View Mint Detail" links of tracked mints.
  await expect(result(page).locator('a')).toHaveCount(1)
})

test('copy button copies exactly the target', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  await input(page).fill(encode({ transports: [{ type: PaymentRequestTransportType.POST, target: POST_URL }] }))
  await result(page).getByRole('button', { name: 'Copy: post transport target' }).click()
  await expect(result(page).getByRole('button', { name: 'Copy: post transport target' })).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(POST_URL)
})

test.describe('malformed input gives one calm message and never reaches the error boundary', () => {
  const CASES: Record<string, string> = {
    'wrong prefix': 'cashuBabcdef',
    'creq without version': 'creqBabcdef',
    'bad base64': 'creqA!!!!%%%%',
    'bad CBOR': 'creqA' + Buffer.from([0xff, 0xff, 0xff, 0xff]).toString('base64url'),
  }
  for (const [name, text] of Object.entries(CASES)) {
    test(name, async ({ page }) => {
      const problems: string[] = []
      page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
      page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
      await open(page)
      await input(page).fill(text)
      await expect(errorBox(page)).toBeVisible()
      await expect(result(page)).toHaveCount(0)
      if (name === 'wrong prefix' || name === 'creq without version') await expect(errorBox(page)).toHaveText(PREFIX_ERROR)
      else await expect(errorBox(page)).toHaveText('This does not look like a valid payment request.')
      await expect(page.locator('.route-error, [data-testid="route-error"]')).toHaveCount(0)
      await expect(card(page)).toBeVisible()
      expect(problems).toEqual([])
    })
  }

  test('a creqB with a bad checksum gives the one calm message', async ({ page }) => {
    const problems: string[] = []
    page.on('pageerror', e => problems.push(`pageerror: ${e.message}`))
    await open(page)
    await input(page).fill(NUT26_EXAMPLE.slice(0, -1) + 'P')
    await expect(errorBox(page)).toHaveText('This does not look like a valid payment request.')
    await expect(result(page)).toHaveCount(0)
    expect(problems).toEqual([])
  })

  test('a creqB over 1,023 characters: a calm length message', async ({ page }) => {
    await open(page)
    await input(page).fill('creqb1' + 'q'.repeat(1100))
    await expect(errorBox(page)).toContainText('longer than 1,023 characters')
    await expect(result(page)).toHaveCount(0)
  })

  test('over 4096 characters: a calm length message', async ({ page }) => {
    await open(page)
    await input(page).fill('creqA' + 'A'.repeat(5000))
    await expect(errorBox(page)).toContainText('longer than 4,096 characters')
    await expect(result(page)).toHaveCount(0)
  })

  test('the message goes away when the input is cleared or corrected', async ({ page }) => {
    await open(page)
    await input(page).fill('nonsense')
    await expect(errorBox(page)).toBeVisible()
    await input(page).fill(encode())
    await expect(errorBox(page)).toHaveCount(0)
    await expect(result(page)).toBeVisible()
    await input(page).fill('')
    await expect(result(page)).toHaveCount(0)
    await expect(card(page)).toContainText('Paste a payment request first')
  })
})

test('NUT-26 creqB: the example of the spec shows its mint and description, with the one-shot note and no open-amount note', async ({ page }) => {
  await open(page)
  await expect(input(page)).toHaveAttribute('placeholder', 'creqA… or creqB…')
  await expect(card(page)).toContainText('Paste a Cashu payment request (NUT-18 creqA or NUT-26 creqB) to read what it asks for and which mints it accepts.')
  await input(page).fill(NUT26_EXAMPLE)
  await expect(errorBox(page)).toHaveCount(0)
  await expect(result(page)).toContainText('demo123')
  await expect(result(page)).toContainText('Coffee payment')
  await expect(page.getByTestId('pr-amount')).toContainText('1,000')
  const mints = result(page).getByTestId('pr-mint')
  await expect(mints).toHaveCount(1)
  await expect(mints.first()).toContainText('https://mint.example.com')
  await expect(result(page).getByTestId('pr-one-shot')).toHaveText('One-shot: this request can be paid only once.')
  await expect(result(page).getByTestId('pr-open-amount')).toHaveCount(0)
  // lower case is accepted too
  await input(page).fill(NUT26_EXAMPLE.toLowerCase())
  await expect(result(page)).toContainText('Coffee payment')
})

test('notes: open amount when no amount is set; nothing about reuse for a request that is not single use', async ({ page }) => {
  await open(page)
  await input(page).fill(encode())
  await expect(result(page).getByTestId('pr-open-amount')).toHaveText('Open amount: the sender chooses how much to send.')
  await expect(result(page).getByTestId('pr-one-shot')).toHaveCount(0)
  await expect(result(page)).not.toContainText(/reusable/i)
  await input(page).fill(encode({ amount: 21 }))
  await expect(result(page).getByTestId('pr-amount')).toContainText('21')
  await expect(result(page).getByTestId('pr-open-amount')).toHaveCount(0)
})

for (const [name, text] of [['creqA', A_MP_SM], ['creqB', B_MP_SM]] as const) {
  test(`${name} with mp and sm: the preferred-list note and the "Other mints" rows with their fee in the request's unit`, async ({ page }) => {
    await open(page)
    await input(page).fill(text)
    await expect(errorBox(page)).toHaveCount(0)
    await expect(result(page)).toContainText('ext-1')
    await expect(result(page).getByTestId('pr-mint')).toHaveCount(1)
    await expect(result(page).getByTestId('pr-mint-list-type')).toHaveText(MINT_PREFERRED)
    await expect(result(page).getByText('Other mints', { exact: true })).toBeVisible()
    const rows = result(page).getByTestId('pr-method')
    await expect(rows).toHaveText(['bolt11 · no extra fee', 'onchain · fee 50 sat'])
    await expect(result(page).getByTestId('pr-methods-note')).toHaveText(OTHER_MINTS_NOTE)
    await expect(result(page).locator('a')).toHaveCount(1) // still only "View Mint Detail"
  })
}

test('a strict mint list with sm adds one sentence; a preferred list or no list does not', async ({ page }) => {
  await open(page)
  const strict = result(page).getByTestId('pr-methods-strict')
  await input(page).fill(A_SM_STRICT) // m set, mp absent: strict
  await expect(result(page).getByTestId('pr-method')).toHaveCount(2)
  await expect(result(page).getByTestId('pr-mint-list-type')).toHaveText(MINT_STRICT)
  await expect(result(page).getByTestId('pr-methods-note')).toHaveText(OTHER_MINTS_NOTE)
  await expect(strict).toHaveText(STRICT_LIST_NOTE)
  await input(page).fill(A_MP_SM) // mp true: preferred
  await expect(result(page).getByTestId('pr-method')).toHaveCount(2)
  await expect(strict).toHaveCount(0)
  await input(page).fill(A_SM_NO_MINTS) // no list at all
  await expect(result(page).getByTestId('pr-method')).toHaveText(['onchain · fee 50 sat'])
  await expect(result(page).getByTestId('pr-methods-note')).toHaveText(OTHER_MINTS_NOTE)
  await expect(strict).toHaveCount(0)
})

test('a mint list always says its type: mp absent or false = strict, without sm too; mp true without a mint list says nothing', async ({ page }) => {
  await open(page)
  // These all list mints and have no mp (or mp false): "Mint list: strict", and no "Other mints" section without sm.
  for (const text of [encode(), encode({ amount: 21 }), NUT26_EXAMPLE, A_MP_FALSE]) {
    await input(page).fill(text)
    await expect(result(page)).toBeVisible()
    await expect(result(page).getByTestId('pr-mint-list-type')).toHaveText(MINT_STRICT)
    await expect(result(page).getByTestId('pr-methods')).toHaveCount(0)
    await expect(result(page).getByText('Other mints', { exact: true })).toHaveCount(0)
  }
  // No mint list: mp is ignored (NUT-18), so no sentence about the list.
  await input(page).fill(A_MP_NO_MINTS)
  await expect(result(page)).toBeVisible()
  await expect(result(page).getByTestId('pr-mint-list-type')).toHaveCount(0)
})

test('transport tags are plain text after the type (nostr · NIPs: 17); a relay hint is a plain line, never a link', async ({ page }) => {
  await open(page)
  const encoded = new PaymentRequest(
    [{ type: PaymentRequestTransportType.NOSTR, target: NPROFILE, tags: [['n', '17'], ['r', 'wss://relay.example.com']] }],
    'tags-1', undefined, undefined, [KNOWN],
  ).toEncodedCreqA()
  await input(page).fill(encoded)
  const row = result(page).getByTestId('pr-transport')
  await expect(row.getByTestId('pr-transport-type')).toHaveText('nostr · NIPs: 17')
  await expect(row.getByTestId('pr-transport-tag')).toHaveText('Relays: wss://relay.example.com')
  await expect(row.locator('a')).toHaveCount(0)
})

test('decoding sends nothing: no request carries the pasted string, no /api call is caused by decoding', async ({ page }) => {
  // The app warms the Stats page by itself once the mint list has rendered (scheduleStatsWarmup: its chunk and /api/stats).
  // That is background work of the app, not of decoding: wait for it to finish before looking at what decoding sends.
  trackRequests(page)
  const warmedUp = page.waitForRequest(r => /\/api\/stats(\?|$)/.test(r.url()))
  await open(page)
  await warmedUp
  await networkQuiet(page)
  const text = encode({ amount: 7, description: 'private-marker-9137', transports: [{ type: PaymentRequestTransportType.POST, target: POST_URL }] })
  await flush(page)
  const seen: { url: string; body: string | null }[] = []
  page.on('request', r => seen.push({ url: r.url(), body: r.postData() }))
  await input(page).fill(text)
  await expect(result(page)).toBeVisible()
  await input(page).fill('creqA-not-a-request')
  await expect(errorBox(page)).toBeVisible()
  await input(page).fill(text)
  await expect(result(page)).toBeVisible()
  await flush(page)
  const own = seen.filter(r => !r.url.endsWith('/__e2e_barrier__'))
  expect(own.filter(r => r.url.includes('/api/'))).toEqual([])
  const needles = [text, text.slice(5, 60), 'private-marker-9137', encodeURIComponent(text)]
  for (const r of own) for (const n of needles) {
    expect(r.url, r.url).not.toContain(n)
    expect(r.body ?? '', r.url).not.toContain(n)
  }
  expect(own).toEqual([])
})

test.describe('layout', () => {
  // Task U: desktop = two columns (left: Token inspector, then Payment request inspector; right: Best mint for me); one column
  // below 901 px; DOM order = visual order; natural card heights.
  const boxes = (page: Page) => page.evaluate(() => {
    const r = (sel: string) => { const b = document.querySelector(sel)!.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom } }
    const order = Array.from(document.querySelectorAll('.tools-grid [id]')).filter(e => ['token', 'payment-request', 'pick'].includes(e.id)).map(e => e.id)
    return { token: r('#token'), pr: r('#payment-request'), pick: r('#pick'), order, input: r('.pr-input'), prCard: r('[data-testid="payment-request-inspector"]') }
  })

  test('1440px and 901px: Token inspector and Payment request inspector stacked on the left, Best mint on the right, natural heights', async ({ page }) => {
    for (const w of [1440, 901] as const) {
      await open(page, [w, 900])
      await layoutReady(page)
      const b = await boxes(page)
      expect(b.order, 'DOM order').toEqual(['token', 'payment-request', 'pick'])
      expect(Math.abs(b.pr.x - b.token.x), `${w}: same column`).toBeLessThanOrEqual(1)
      expect(Math.abs(b.pr.w - b.token.w), `${w}: same width`).toBeLessThanOrEqual(1)
      expect(b.pr.y, `${w}: stacked under the Token inspector`).toBeGreaterThanOrEqual(b.token.b - 1)
      expect(b.pick.x, `${w}: Best mint is the right column`).toBeGreaterThanOrEqual(b.token.r - 1)
      expect(Math.abs(b.pick.y - b.token.y), `${w}: columns start together`).toBeLessThanOrEqual(1)
      expect(b.pr.w, `${w}: the card is not full width`).toBeLessThan(b.pick.r - b.token.x - 100)
      expect(b.input.r, `${w}: the textarea fits its column`).toBeLessThanOrEqual(b.token.r + 0.5)
      // natural height: the wizard is not stretched to the left column and the left cards are not stretched to it
      expect(Math.abs(b.token.h - (await page.locator('#token .tool-card').first().evaluate(e => e.getBoundingClientRect().height))), `${w}: token anchor = its card`).toBeLessThanOrEqual(2)
    }
  })

  for (const w of [768, 390, 320] as const) {
    test(`${w}px: one column in the order Token inspector, Payment request inspector, Best mint for me`, async ({ page }) => {
      await open(page, [w, 900])
      await layoutReady(page)
      const b = await boxes(page)
      expect(b.order).toEqual(['token', 'payment-request', 'pick'])
      expect(Math.abs(b.pr.x - b.token.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.pick.x - b.token.x)).toBeLessThanOrEqual(1)
      expect(b.pr.y).toBeGreaterThanOrEqual(b.token.b - 1)
      expect(b.pick.y).toBeGreaterThanOrEqual(b.pr.b - 1)
    })
  }

  test('the #payment-request anchor still scrolls to and focuses the card', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await resize(page, 1440, 900)
    await page.goto('/tools#payment-request')
    await expect(card(page)).toBeVisible()
    await expect(page.locator('#payment-request')).toBeInViewport()
  })

  const LONG_DESC = 'Lorem'.padEnd(300, 'ipsum')
  const LONG_URL = `https://${'very-long-subdomain-label-'.repeat(6)}example.com/${'path/segment/'.repeat(20)}end`
  const LONG_TARGET = `https://callback.example.com/${'q'.repeat(400)}`

  for (const w of [320, 390, 768, 1440] as const) {
    test(`${w}px: long description, mint URL, transport target and lock data stay inside the page`, async ({ page }) => {
      await open(page, [w, 900])
      await input(page).fill(encode({
        amount: 1234567, description: LONG_DESC, mints: [LONG_URL, KNOWN],
        transports: [{ type: PaymentRequestTransportType.POST, target: LONG_TARGET }, { type: PaymentRequestTransportType.NOSTR, target: NPROFILE.repeat(4) }],
        lock: true, id: 'i'.repeat(120),
      }))
      await expect(result(page)).toBeVisible()
      await layoutReady(page)
      const overflow = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth
        const wide = Array.from(document.querySelectorAll<HTMLElement>('.pr-result *')).filter(e => e.getBoundingClientRect().right > vw + 1).map(e => e.className || e.tagName)
        return { scroll: document.documentElement.scrollWidth - vw, wide }
      })
      expect(overflow.scroll).toBeLessThanOrEqual(1)
      expect(overflow.wide).toEqual([])
      const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.pr-result, .pr-result *'))
        .filter(e => e.childNodes.length && Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent?.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12)
        .map(e => e.className))
      expect(small).toEqual([])
    })
  }
})

test('keyboard: textarea, then the Mint Detail link, then the copy buttons; Enter on the link opens the mint', async ({ page }) => {
  await open(page)
  await input(page).focus()
  await input(page).fill(encode({ transports: [{ type: PaymentRequestTransportType.POST, target: POST_URL }, { type: PaymentRequestTransportType.NOSTR, target: NPROFILE }] }))
  await expect(result(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(result(page).getByRole('link', { name: 'View Mint Detail' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(result(page).getByRole('button', { name: 'Copy: post transport target' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(result(page).getByRole('button', { name: 'Copy: nostr transport target' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(result(page).getByRole('link', { name: 'View Mint Detail' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/mint/${encodeURIComponent(KNOWN).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
})

test.describe('the known-mints list is not there (yet): nothing is claimed about a mint', () => {
  test('while it loads: "Looking it up", never "Not tracked"; once it arrives the result is final', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => { release = r })
    let reached = false
    await page.route('**/api/mints/known', async route => { reached = true; await gate; await route.fulfill({ json: MOCK_KNOWN_MINTS }) })
    await page.goto('/tools')
    await expect(card(page)).toBeVisible()
    await expect.poll(() => reached).toBe(true)
    await input(page).fill(encode())
    const mints = result(page).getByTestId('pr-mint')
    await expect(mints).toHaveCount(2)
    await expect(result(page).getByTestId('pr-mint-list-state')).toHaveText(["Looking it up in MintRadar's list…", "Looking it up in MintRadar's list…"])
    await expect(result(page)).not.toContainText('Not tracked')
    release()
    await expect(mints.nth(0)).toContainText('Alpha Mint')
    await expect(mints.nth(1)).toContainText('Not tracked by MintRadar.')
    await expect(result(page).getByTestId('pr-mint-list-state')).toHaveCount(0)
  })

  test('when it cannot be loaded: a fixed line, never "Not tracked" and never a status', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/known', route => route.fulfill({ status: 500, json: { error: 'boom' } }))
    await page.goto('/tools')
    await expect(card(page)).toBeVisible()
    await input(page).fill(encode())
    await expect(result(page).getByTestId('pr-mint-list-state').first()).toHaveText("MintRadar's list could not be loaded, so this mint is not looked up.")
    await expect(result(page)).not.toContainText(/Not tracked|Online|Offline/)
    await expect(result(page).getByTestId('pr-mint-status')).toHaveCount(0)
  })
})

// Task Q1: transports wording and the status dot.
const NO_TRANSPORT_REQUEST = 'creqApGFpaHRlc3QwMDAyYWEYZGF1Y3NhdGFkb05vIG1pbnRzIGxpc3RlZA'
const NO_TRANSPORTS_TEXT = 'None listed: the payment is returned directly (in-band)'

test('no transports: the Transports section explains in-band return; a request with a transport does not show it', async ({ page }) => {
  await open(page)
  await input(page).fill(NO_TRANSPORT_REQUEST)
  await expect(result(page)).toBeVisible()
  await expect(result(page).getByTestId('pr-no-transports')).toHaveText(NO_TRANSPORTS_TEXT)
  // The other rows keep "Not specified" (Single use, Locking condition): the new sentence is only for transports.
  await expect(page.getByTestId('pr-lock')).toHaveText(/Not specified/)
  await expect(result(page).locator('.pr-value', { hasText: 'Not specified' }).first()).toBeVisible()

  await input(page).fill(encode({ transports: [{ type: PaymentRequestTransportType.POST, target: POST_URL }] }))
  await expect(result(page).getByTestId('pr-transport')).toHaveCount(1)
  await expect(result(page).getByTestId('pr-no-transports')).toHaveCount(0)
  await expect(result(page)).not.toContainText('None listed')
})

test('the status dot of an online mint in the inspector has the same computed colour as the dot on the mint card', async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, 1440, 900)
  await page.goto('/')
  const cardDot = page.locator('.mint-card', { hasText: 'Alpha Mint' }).locator('.status-dot')
  await expect(cardDot).toBeVisible()
  const cardColor = await cardDot.evaluate(el => getComputedStyle(el).backgroundColor)

  await page.goto('/tools')
  await expect(card(page)).toBeVisible()
  await input(page).fill(encode())
  const dot = result(page).getByTestId('pr-mint').first().getByTestId('pr-mint-dot')
  await expect(dot).toBeVisible()
  expect(await dot.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(cardColor)
  expect(cardColor).not.toBe('rgba(0, 0, 0, 0)')
})
