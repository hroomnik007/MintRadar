import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, makeCashuToken, makeDleqMint, serveMintInPage, MOCK_MINTS, MOCK_KNOWN_MINTS, type DleqMintFixture } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Token inspector result in two labelled parts: "Decode" (read locally, nothing sent) and "Verify" (asks the mint, every
// line with "Asked mint <host> at <time>"). Texts are the existing ones; only structure and headings are new.

const MINT = MOCK_MINTS[0]!.url // https://alpha.mint.example, tracked, score 92
const decode = (page: Page) => page.getByTestId('token-decode')
const verify = (page: Page) => page.getByTestId('token-verify-part')

async function open(page: Page, size: [number, number] = [1440, 900]) {
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, size[0], size[1])
  await page.goto('/tools')
  await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()
}

/** The mint's /v1/keys answers only after the test calls window.__releaseMint(); `fail` makes every request to the mint fail instead. */
async function gatedMint(page: Page, fx: DleqMintFixture, mode: 'gate' | 'fail') {
  await page.addInitScript(({ mint, routes, mode }) => {
    const realFetch = window.fetch.bind(window)
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => { release = r })
    ;(window as unknown as { __releaseMint: () => void }).__releaseMint = release
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      if (!url.startsWith(mint + '/v1/')) return realFetch(input, init)
      if (mode === 'fail') throw new TypeError('mint down')
      const path = url.slice(mint.length)
      if (path === '/v1/info') return json(routes.info)
      if (path === '/v1/keysets') return json(routes.keysets)
      if (path.startsWith('/v1/keys')) { await gate; return json(routes.keys) }
      if (path === '/v1/checkstate') {
        const ys: string[] = JSON.parse(String(init?.body ?? '{}')).Ys ?? []
        return json({ states: ys.map(Y => ({ Y, state: 'UNSPENT', witness: null })) })
      }
      return new Response('not found', { status: 404 })
    }
  }, { mint: fx.mint, routes: fx.routes, mode })
}

const inspect = async (page: Page, token: string) => {
  await page.locator('.token-input').fill(token)
  await page.getByRole('button', { name: /Inspect & Verify Token/ }).click()
}

test('Decode and Verify are two labelled parts, Decode first; Decode holds what the token contains', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }, { amount: 2, dleq: 'valid' }])
  await serveMintInPage(page, fx)
  await open(page)
  await inspect(page, fx.token)
  await expect(verify(page)).toContainText('Verified.', { timeout: 15_000 })
  await expect(page.locator('.token-part-title')).toHaveText(['Decode', 'Verify'])
  await expect(decode(page)).toContainText('Nothing is sent')
  await expect(decode(page)).toContainText('Alpha Mint')
  await expect(decode(page)).toContainText('alpha.mint.example')
  await expect(decode(page)).toContainText('Proofs2')
  await expect(verify(page)).toContainText('Asks the mint named in the token')
  await expect(verify(page).locator('.token-verify-result')).toContainText('Verified.')
  // Nothing from Verify leaks into Decode and the other way round.
  await expect(decode(page)).not.toContainText('Signature check')
  await expect(verify(page)).not.toContainText('Mint Status')
})

test('Decode is visible while Verify is pending; the source line appears when the mint has answered', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 4, dleq: 'valid' }])
  await gatedMint(page, fx, 'gate')
  await open(page)
  await inspect(page, fx.token)
  await expect(verify(page).locator('.tv-loading')).toContainText('Verifying with mint')
  await expect(decode(page)).toBeVisible()
  await expect(decode(page)).toContainText('Alpha Mint')
  await expect(decode(page)).toContainText('4')
  await expect(page.getByTestId('token-verify-source')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { __releaseMint: () => void }).__releaseMint())
  await expect(verify(page).locator('.token-verify-result')).toContainText('Verified.')
  await expect(page.getByTestId('token-verify-source')).toHaveText(/^Asked mint alpha\.mint\.example at \d{1,2} \w{3} \d{4}, \d{2}:\d{2} UTC$/)
})

test('the mint does not answer: Decode stays, Verify shows the existing calm line', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 4, dleq: 'valid' }])
  await gatedMint(page, fx, 'fail')
  await open(page)
  await inspect(page, fx.token)
  await expect(verify(page).locator('.token-verify-result')).toHaveText('Could not reach mint to verify (try again later). This says nothing about the token itself.', { timeout: 15_000 })
  await expect(decode(page)).toBeVisible()
  await expect(decode(page)).toContainText('Alpha Mint')
  await expect(decode(page)).toContainText('4')
  await expect(verify(page).locator('.token-verify-result')).toHaveCount(1)
})

test('a test mint: Decode shows no score, only the neutral line; Verify is unchanged', async ({ page }) => {
  const testMint = { ...MOCK_KNOWN_MINTS[0]!, url: 'https://testnut.cashu.space', name: 'Testnut', reliabilityScore: 88 }
  await open(page)
  await page.route('**/api/mints/known', route => route.fulfill({ json: [...MOCK_KNOWN_MINTS, testMint] }))
  await page.reload()
  const fx = makeDleqMint(testMint.url, [{ amount: 1, dleq: 'valid' }])
  await serveMintInPage(page, fx)
  await page.reload()
  await inspect(page, fx.token)
  await expect(decode(page)).toContainText('Test mint. Ecash from it has no value.')
  await expect(decode(page)).not.toContainText('88')
  await expect(verify(page)).toContainText('Verified.', { timeout: 15_000 })
})

test('a DLEQ proof that does not match the keys: the existing message, in Verify, Decode untouched', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }, { amount: 2, dleq: 'tampered' }])
  await serveMintInPage(page, fx)
  await open(page)
  await inspect(page, fx.token)
  await expect(verify(page).locator('.token-verify-result')).toHaveText("The DLEQ proof does not match this mint's published keys. The token may have been altered, or the mint may be using different keys.", { timeout: 15_000 })
  await expect(decode(page)).toContainText('Alpha Mint')
})

test('Check if spent lives in Verify, with its own source line', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }])
  await serveMintInPage(page, fx, { checkstate: 'UNSPENT' })
  await open(page)
  await inspect(page, fx.token)
  await expect(verify(page)).toContainText('Verified.', { timeout: 15_000 })
  await expect(verify(page).getByRole('button', { name: 'Check if spent' })).toBeVisible()
  await expect(decode(page).getByRole('button')).toHaveCount(0)
  await verify(page).getByRole('button', { name: 'Check if spent' }).click()
  await expect(verify(page)).toContainText('unspent', { timeout: 15_000 })
  await expect(page.getByTestId('token-spent-source')).toHaveText(/^Asked mint alpha\.mint\.example at .* UTC$/)
})

test('a token with a spending condition and a keyset id: both are read locally and shown under Decode', async ({ page }) => {
  await open(page)
  const payload = { token: [{ mint: MINT, proofs: [{ amount: 2, secret: '["P2PK",{"nonce":"a","data":"02ab","tags":[]}]', C: '02abc', id: '009a1f293253e41e' }] }], unit: 'sat' }
  await inspect(page, 'cashuA' + Buffer.from(JSON.stringify(payload)).toString('base64url'))
  await expect(decode(page).getByTestId('token-conditions')).toContainText('P2PK')
  await expect(decode(page).getByTestId('token-keyset-ids')).toContainText('009a1f293253e41e')
  await expect(verify(page)).toBeVisible()
})

for (const w of [320, 390, 1440] as const) {
  test(`${w}px: a very long mint URL and memo stay inside the page, Decode and Verify both visible`, async ({ page }) => {
    await open(page, [w, 900])
    const longMint = `https://${'long-subdomain-label-'.repeat(6)}example.com/${'path/segment/'.repeat(60)}`
    await inspect(page, makeCashuToken(longMint, [21], 'sat', 'm'.repeat(300)))
    await expect(decode(page)).toBeVisible()
    await expect(verify(page)).toBeVisible()
    await expect(verify(page).locator('.token-verify-result').first()).toBeVisible()
    await layoutReady(page)
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const wide = Array.from(document.querySelectorAll<HTMLElement>('.tool-card *')).filter(e => e.getBoundingClientRect().right > vw + 1 && getComputedStyle(e).position !== 'fixed').map(e => e.className || e.tagName)
      return { scroll: document.documentElement.scrollWidth - vw, wide }
    })
    expect(m.scroll).toBeLessThanOrEqual(1)
    expect(m.wide).toEqual([])
  })
}

test('keyboard order: textarea, Inspect, the Signature check help, Check if spent, then the actions', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }])
  await serveMintInPage(page, fx)
  await open(page)
  await page.locator('.token-input').fill(fx.token)
  await page.getByRole('button', { name: /Inspect & Verify Token/ }).focus()
  await page.keyboard.press('Enter')
  await expect(verify(page)).toContainText('Verified.', { timeout: 15_000 })
  await page.getByRole('button', { name: /Inspect & Verify Token/ }).focus()
  const names: string[] = []
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    names.push(await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      return (a?.getAttribute('aria-label') ?? a?.textContent ?? '').replace(/\s+/g, ' ').trim()
    }))
  }
  expect(names[0]).toMatch(/Signature check/i)
  expect(names[1]).toMatch(/Check if spent/)
  expect(names[2]).toMatch(/Redeem to Lightning/)
  expect(names[3]).toMatch(/View Mint Detail/)
  expect(names[4]).toMatch(/Open in cashu\.me/)
})

test.describe('"Not in database" only when the known-mints list really lacks the mint', () => {
  const statusCell = (page: Page) => page.locator('.token-result-cell', { hasText: 'Mint Status' })

  test('pasted before the list has loaded: a neutral lookup line, then the real answer', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => { release = r })
    let reached = false
    await page.route('**/api/mints/known', async route => { reached = true; await gate; await route.fulfill({ json: MOCK_KNOWN_MINTS }) })
    await page.goto('/tools')
    await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()
    await expect.poll(() => reached).toBe(true)
    await inspect(page, makeCashuToken(MINT, [21]))
    await expect(decode(page)).toBeVisible()
    await expect(page.getByTestId('token-list-state')).toHaveText("Looking it up in MintRadar's list…")
    await expect(statusCell(page)).not.toContainText('Not in database')
    release()
    await expect(statusCell(page)).toContainText('Online')
    await expect(page.getByTestId('token-list-state')).toHaveCount(0)
  })

  test('the list request fails: one fixed sentence, never "Not in database"', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    await page.route('**/api/mints/known', route => route.fulfill({ status: 500, json: { error: 'boom' } }))
    await page.goto('/tools')
    await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()
    await inspect(page, makeCashuToken(MINT, [21]))
    await expect(page.getByTestId('token-list-state')).toHaveText("MintRadar's list is not available right now.", { timeout: 20_000 })
    await expect(statusCell(page)).not.toContainText('Not in database')
    await expect(decode(page)).toContainText('alpha.mint.example')
  })

  test('a loaded list that lacks the mint: "Not in database"', async ({ page }) => {
    await open(page)
    await inspect(page, makeCashuToken('https://never-seen.mint.example', [21]))
    await expect(statusCell(page)).toContainText('Not in database')
    await expect(page.getByTestId('token-list-state')).toHaveCount(0)
  })
})
