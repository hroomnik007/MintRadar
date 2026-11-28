import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, makeCashuToken, makeDleqMint, serveMintInPage, MOCK_MINTS, MOCK_KNOWN_MINTS, type DleqMintFixture } from './fixtures/mocks'
import { layoutReady, resize } from './fixtures/settle'

// Token inspector result. Until 2026-11-28 it was two labelled parts, "Decode" and "Verify"; since the second review pass
// that day (owner-approved mockup ~/Claude/refs/mintradar-inspectors-mockup-1128) it is a result card (the amount, a
// signature chip and a spent chip, the actions) and ONE details table; the line under the table says what was read
// locally and what the mint was asked, with the time.

const MINT = MOCK_MINTS[0]!.url // https://alpha.mint.example, tracked, score 92
const details = (page: Page) => page.getByTestId('token-details')
const sigRow = (page: Page) => page.getByTestId('token-signatures').locator('.token-verify-result')
const sigChip = (page: Page) => page.getByTestId('token-sig-chip')

async function open(page: Page, size: [number, number] = [1440, 900]) {
  await mockRelays(page)
  await installApiMocks(page)
  await resize(page, size[0], size[1])
  await page.goto('/tools')
  await expect(page.locator('.tool-title', { hasText: 'Token inspector' })).toBeVisible()
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
  await page.getByRole('button', { name: /Inspect token/ }).click()
}

test('one result card and one details table; no Decode / Verify parts', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }, { amount: 2, dleq: 'valid' }])
  await serveMintInPage(page, fx)
  await open(page)
  await inspect(page, fx.token)
  await expect(sigChip(page)).toHaveText('Signed by Alpha Mint', { timeout: 15_000 })
  await expect(page.getByTestId('token-amount')).toHaveText('3 sat')
  await expect(page.locator('.token-part-title')).toHaveCount(0)
  await expect(details(page).locator('.tdt-label')).toHaveText(['Mint', 'Mint status', 'Reliability Score', 'Signatures', 'Mint fee', 'Format'])
  await expect(details(page)).toContainText('Alpha Mint')
  await expect(details(page)).toContainText('alpha.mint.example')
  await expect(page.getByTestId('token-row-format')).toContainText('· 2 coins')
  await expect(sigRow(page)).toHaveText('All 2 coins signed by this mint')
  await expect(details(page)).toContainText('Does not show whether they are spent.')
  // The result card comes first, the table after it.
  expect((await page.getByTestId('token-verdict').boundingBox())!.y).toBeLessThan((await details(page).boundingBox())!.y)
})

test('the table is there while the mint is asked; the source line appears when it has answered', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 4, dleq: 'valid' }])
  await gatedMint(page, fx, 'gate')
  await open(page)
  await inspect(page, fx.token)
  await expect(sigChip(page)).toHaveText('Checking signatures…')
  await expect(sigRow(page)).toHaveText('Checking with the mint…')
  await expect(details(page)).toContainText('Alpha Mint')
  await expect(page.getByTestId('token-amount')).toHaveText('4 sat')
  await expect(page.getByTestId('token-verify-source')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { __releaseMint: () => void }).__releaseMint())
  await expect(sigChip(page)).toHaveText('Signed by Alpha Mint')
  await expect(page.getByTestId('token-verify-source')).toHaveText(/^Asked alpha\.mint\.example about the signatures at \d{1,2} \w{3} \d{4}, \d{2}:\d{2} UTC$/)
})

test('the mint does not answer: the table stays, the Signatures row says so calmly', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 4, dleq: 'valid' }])
  await gatedMint(page, fx, 'fail')
  await open(page)
  await inspect(page, fx.token)
  await expect(sigRow(page)).toHaveText('Could not reach the mint (try again later). This says nothing about the token itself.', { timeout: 15_000 })
  await expect(sigChip(page)).toHaveText('Signatures not checked')
  await expect(details(page)).toContainText('Alpha Mint')
  await expect(page.getByTestId('token-amount')).toHaveText('4 sat')
})

test('a test mint: no score, the test-mint sentence once; the signatures are still checked', async ({ page }) => {
  const testMint = { ...MOCK_KNOWN_MINTS[0]!, url: 'https://testnut.cashu.space', name: 'Testnut', reliabilityScore: 88 }
  await open(page)
  await page.route('**/api/mints/known', route => route.fulfill({ json: [...MOCK_KNOWN_MINTS, testMint] }))
  await page.reload()
  const fx = makeDleqMint(testMint.url, [{ amount: 1, dleq: 'valid' }])
  await serveMintInPage(page, fx)
  await page.reload()
  await inspect(page, fx.token)
  await expect(page.getByTestId('token-row-score')).toContainText('Not scored (test mint)')
  await expect(details(page)).not.toContainText('88')
  await expect(page.getByText('Ecash from a test mint has no value.')).toHaveCount(1)
  await expect(sigChip(page)).toHaveText('Signed by Testnut', { timeout: 15_000 })
})

test('a DLEQ proof that does not match the keys: the full sentence in the row, a short warning chip', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }, { amount: 2, dleq: 'tampered' }])
  await serveMintInPage(page, fx)
  await open(page)
  await inspect(page, fx.token)
  await expect(sigRow(page)).toHaveText("The DLEQ proof does not match this mint's published keys. The token may have been altered, or the mint may be using different keys.", { timeout: 15_000 })
  await expect(sigChip(page)).toHaveText("Signatures don't match this mint")
  await expect(sigChip(page)).toHaveClass(/tvd-chip-warn/)
})

test('Check if spent sits in the result card above the table; its answer is the spent chip and the source line', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }])
  await serveMintInPage(page, fx, { checkstate: 'UNSPENT' })
  await open(page)
  await inspect(page, fx.token)
  await expect(sigChip(page)).toHaveText('Signed by Alpha Mint', { timeout: 15_000 })
  const check = page.getByTestId('token-verdict').getByRole('button', { name: 'Check if spent' })
  await expect(check).toBeVisible()
  await expect(details(page).getByRole('button', { name: 'Check if spent' })).toHaveCount(0)
  expect((await check.boundingBox())!.y).toBeLessThan((await details(page).boundingBox())!.y)
  await check.click()
  await expect(page.getByTestId('token-spent-chip')).toHaveText('Not spent', { timeout: 15_000 })
  await expect(page.getByTestId('token-spent-chip')).toHaveClass(/tvd-chip-ok/)
  await expect(page.getByTestId('token-spent-source')).toHaveText(/^whether spent at .* UTC$/)
})

test('a token with a spending condition: read locally and shown in the table', async ({ page }) => {
  await open(page)
  const payload = { token: [{ mint: MINT, proofs: [{ amount: 2, secret: '["P2PK",{"nonce":"a","data":"02ab","tags":[]}]', C: '02abc', id: '009a1f293253e41e' }] }], unit: 'sat' }
  await inspect(page, 'cashuA' + Buffer.from(JSON.stringify(payload)).toString('base64url'))
  await expect(details(page).getByTestId('token-conditions')).toContainText('P2PK')
})

for (const w of [320, 390, 1440] as const) {
  test(`${w}px: a very long mint URL and memo stay inside the page, the card and the table both visible`, async ({ page }) => {
    await open(page, [w, 900])
    const longMint = `https://${'long-subdomain-label-'.repeat(6)}example.com/${'path/segment/'.repeat(60)}`
    await inspect(page, makeCashuToken(longMint, [21], 'sat', 'm'.repeat(300)))
    await expect(page.getByTestId('token-verdict')).toBeVisible()
    await expect(details(page)).toBeVisible()
    await expect(sigRow(page)).toBeVisible()
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

test('keyboard order: Inspect, the actions and their ⓘ, then the mint link, the Signatures and Mint fee help', async ({ page }) => {
  const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }])
  await serveMintInPage(page, fx)
  await open(page)
  await page.locator('.token-input').fill(fx.token)
  await page.getByRole('button', { name: /Inspect token/ }).focus()
  await page.keyboard.press('Enter')
  await expect(sigChip(page)).toHaveText('Signed by Alpha Mint', { timeout: 15_000 })
  await page.getByRole('button', { name: /Inspect token/ }).focus()
  const names: string[] = []
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab')
    names.push(await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      return (a?.getAttribute('aria-label') ?? a?.textContent ?? '').replace(/\s+/g, ' ').trim()
    }))
  }
  // Second pass 2026-11-28: the actions and their ⓘ in the card, then the table (the mint's name is the link to its page).
  expect(names[0]).toMatch(/Check if spent/)
  expect(names[1]).toMatch(/Redeem to Lightning/)
  expect(names[2]).toMatch(/Open in cashu\.me/)
  expect(names[3]).toMatch(/About these buttons/)
  expect(names[4]).toBe('Alpha Mint')
  expect(names[5]).toMatch(/Signatures/i)
  expect(names[6]).toMatch(/Mint fee/i)
})

test.describe('"Not in database" only when the known-mints list really lacks the mint', () => {
  const statusCell = (page: Page) => page.getByTestId('token-row-status')

  test('pasted before the list has loaded: a neutral lookup line, then the real answer', async ({ page }) => {
    await mockRelays(page)
    await installApiMocks(page)
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => { release = r })
    let reached = false
    await page.route('**/api/mints/known', async route => { reached = true; await gate; await route.fulfill({ json: MOCK_KNOWN_MINTS }) })
    await page.goto('/tools')
    await expect(page.locator('.tool-title', { hasText: 'Token inspector' })).toBeVisible()
    await expect.poll(() => reached).toBe(true)
    await inspect(page, makeCashuToken(MINT, [21]))
    await expect(details(page)).toBeVisible()
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
    await expect(page.locator('.tool-title', { hasText: 'Token inspector' })).toBeVisible()
    await inspect(page, makeCashuToken(MINT, [21]))
    await expect(page.getByTestId('token-list-state')).toHaveText("MintRadar's list is not available right now.", { timeout: 20_000 })
    await expect(statusCell(page)).not.toContainText('Not in database')
    await expect(details(page)).toContainText('alpha.mint.example')
  })

  test('a loaded list that lacks the mint: "Not in database"', async ({ page }) => {
    await open(page)
    await inspect(page, makeCashuToken('https://never-seen.mint.example', [21]))
    await expect(statusCell(page)).toContainText('Not in database')
    await expect(page.getByTestId('token-list-state')).toHaveCount(0)
  })
})
