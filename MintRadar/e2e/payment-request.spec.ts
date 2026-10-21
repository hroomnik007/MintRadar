import { test, expect, type Page } from '@playwright/test'
import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts'
import { installApiMocks, mockRelays, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'
import { flush, layoutReady, resize } from './fixtures/settle'

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
  await expect(mints.nth(0).getByTestId('pr-mint-status')).toHaveText('● Online')
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
  await expect(result(page).locator('.pr-note', { hasText: 'Not specified' })).toHaveCount(1)
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
      if (name === 'wrong prefix' || name === 'creq without version') await expect(errorBox(page)).toContainText('expected a string starting with creqA')
      else await expect(errorBox(page)).toHaveText('This does not look like a valid payment request.')
      await expect(page.locator('.route-error, [data-testid="route-error"]')).toHaveCount(0)
      await expect(card(page)).toBeVisible()
      expect(problems).toEqual([])
    })
  }

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

test('decoding sends nothing: no request carries the pasted string, no /api call is caused by decoding', async ({ page }) => {
  await open(page)
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
