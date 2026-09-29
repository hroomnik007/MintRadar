import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, makeCashuToken, makeCashuTokenV4, makeDleqMint, serveMintInPage, MOCK_MINTS, MOCK_KNOWN_MINTS, type DleqKind } from './fixtures/mocks'

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
  await page.goto('/tools')
  await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()
})

test.describe('Tools', () => {
  test('Token Inspector decodes a valid cashu token', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21, 8]) // Alpha Mint, 29 sat total

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    const grid = page.locator('.token-result-grid')
    await expect(grid).toBeVisible()
    await expect(grid).toContainText('Alpha Mint')   // resolved from known mints
    await expect(grid).toContainText('29')           // summed proof amounts
    await expect(grid).toContainText('Online')       // mint status from known mints
  })

  test('Token Inspector decodes a v4 (cashuB) token', async ({ page }) => {
    const token = makeCashuTokenV4(MOCK_MINTS[0]!.url, [21, 8])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    const grid = page.locator('.token-result-grid')
    await expect(grid).toBeVisible()
    await expect(grid).toContainText('Alpha Mint')
    await expect(grid).toContainText('29')
    await expect(page.locator('.token-details-row')).toContainText('v4 (cashuB)')
  })

  test('Token Inspector offers verified wallet + redeem deep links', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    const wallet = page.getByRole('link', { name: /Open in cashu.me/ })
    await expect(wallet).toHaveAttribute('href', new RegExp(`^https://wallet\\.cashu\\.me/\\?token=${token}$`))
    const redeem = page.getByRole('link', { name: /Redeem to Lightning/ })
    await expect(redeem).toHaveAttribute('href', new RegExp(`^https://redeem\\.cashu\\.me/\\?token=${token}$`))
  })

  test('Token Inspector renders a fiat amount in its minor unit, not as whole currency', async ({ page }) => {
    // NUT-01: a usd token carrying 20 is 20 cents, so this must read $0.20 and never $20.
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [15, 5], 'usd')

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    const grid = page.locator('.token-result-grid')
    await expect(grid).toContainText('$0.20')
    await expect(grid).not.toContainText('$20')
  })

  test('Token Inspector keeps sat amounts as whole numbers', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21, 8])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    const amount = page.locator('.token-result-cell', { hasText: 'Amount' })
    await expect(amount).toContainText('29')
    await expect(amount).not.toContainText('$')
    await expect(amount).not.toContainText('0.29')
  })

  test('Inspect & Verify Token runs the local parse then the DLEQ check automatically, no second click', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])

    await page.locator('.token-input').fill(token)
    await expect(page.locator('.token-verify-result')).toHaveCount(0)

    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    // Parse result (mint/amount/etc.) appears without waiting on the network call.
    await expect(page.locator('.token-result-grid')).toBeVisible()
    await expect(page.locator('.token-result-grid')).toContainText('Alpha Mint')

    // The DLEQ step then runs on its own — no second click anywhere in this test.
    // /v1/keysets and /v1/keys are not mocked, so loadMint() fails — a transport
    // failure, which must be reported distinctly from an invalid signature.
    const result = page.locator('.token-verify-result')
    await expect(result).toBeVisible({ timeout: 15_000 })
    await expect(result).toContainText(/Could not reach mint/)
    await expect(result).not.toContainText(/Invalid signature/)
    await expect(result).toHaveClass(/tv-unknown/)

    // The parse result stays on screen throughout — a DLEQ failure never clears it.
    await expect(page.locator('.token-result-grid')).toBeVisible()
  })

  test('Inspect & Verify Token shows a distinct two-phase loading state', async ({ page }) => {
    // The dev server's CSP (connect-src 'self' wss: ws: — deliberately stricter than
    // production's, see vite.config.ts) blocks a real fetch to an external mint before
    // it ever reaches the network layer, so page.route() can't intercept or delay it.
    // Patching fetch in-page sidesteps that: it never calls the real fetch for the mint
    // host, so CSP is never triggered, and the "Verifying…" phase becomes observable on
    // a timer this test controls instead of racing an instant CSP rejection.
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
        if (url.includes('mint.example')) {
          return new Promise((_, reject) => setTimeout(() => reject(new TypeError('simulated slow network failure')), 1500))
        }
        return realFetch(input, init)
      }
    })
    // addInitScript only applies to future navigations — beforeEach already loaded the
    // page before this test body ran, so reload to pick it up (mocked routes persist
    // across the reload; the token box just needs refilling).
    await page.reload()
    await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()

    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])
    await page.locator('.token-input').fill(token)

    const button = page.getByRole('button', { name: /Inspect|Verifying/ })
    await button.click()

    // Phase 1: local parse — held on screen just long enough to be readable.
    await expect(button).toHaveText(/Inspecting/)

    // Phase 2: the live mint check — a different label, so the user can tell this
    // step is the one waiting on the network, not a frozen app.
    await expect(button).toHaveText(/Verifying with mint/, { timeout: 5_000 })

    // Button re-enables once the whole flow (both phases) settles.
    await expect(button).toBeEnabled({ timeout: 15_000 })
    await expect(button).toHaveText('Inspect & Verify Token')
  })

  test('A malformed token never triggers the DLEQ network step', async ({ page }) => {
    let mintFetchSeen = false
    await page.route('**/v1/keysets', route => { mintFetchSeen = true; return route.abort() })

    await page.locator('.token-input').fill('this-is-not-a-cashu-token')
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-error')).toBeVisible()
    // Give any (incorrect) network call a chance to fire before asserting it didn't.
    await page.waitForTimeout(500)
    expect(mintFetchSeen).toBe(false)
    await expect(page.locator('.token-verify-result')).toHaveCount(0)
  })

  test('Token Inspector action buttons keep their full label text on mobile (no clipping)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21, 8])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(page.locator('.token-result-grid')).toBeVisible()

    // A clipped label has scrollWidth > clientWidth (overflow hidden behind the button's
    // own edge) — that was the bug: flex:1 + min-width:0 let these shrink past their text.
    const overflowing = await page.locator('.token-action-btn, .token-link-btn').evaluateAll(
      els => els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent)
    )
    expect(overflowing).toEqual([])
  })

  test('Token Inspector shows the memo when the token carries one', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21], 'sat', 'thanks for lunch')

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-result-grid')).toBeVisible()
    await expect(page.locator('.token-memo-row')).toContainText('thanks for lunch')
  })

  test('Token Inspector hides the memo row for a token with no memo', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-result-grid')).toBeVisible()
    await expect(page.locator('.token-memo-row')).toHaveCount(0)
  })

  test('No risk badge is rendered — only the Reliability Score and Online/Offline cells', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21]) // Alpha: online, reliabilityScore 92

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-result-grid')).toBeVisible()
    await expect(page.locator('.token-risk-badge')).toHaveCount(0)
    await expect(page.locator('.token-result-grid')).not.toContainText(/risk/i)
    await expect(page.locator('.token-result-cell', { hasText: 'Reliability Score' })).toContainText('92%')
  })

  test('A mint MintRadar has never seen shows "Not in database" and no risk badge', async ({ page }) => {
    const token = makeCashuToken('https://never-seen.mint.example', [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-result-cell', { hasText: 'Mint Status' })).toContainText('Not in database')
    await expect(page.locator('.token-risk-badge')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /View Mint Detail/ })).toHaveCount(0)
  })

  test('Test mint chip shows for a token from a known test/dev mint', async ({ page }) => {
    const token = makeCashuToken('https://testnut.cashu.space', [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    const mintCell = page.locator('.token-result-cell', { hasText: 'Mint' }).first()
    await expect(mintCell).toBeVisible()
    await expect(mintCell.locator('.token-test-mint-badge')).toContainText('Test mint')
  })

  test('Test mint chip is absent for a token from a regular production mint', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21]) // Alpha Mint — not a test mint

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-result-grid')).toBeVisible()
    await expect(page.locator('.token-test-mint-badge')).toHaveCount(0)
  })

  test('Check if spent is a separate, user-initiated action — never runs automatically', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(page.locator('.token-result-grid')).toBeVisible()

    // Give the automatic DLEQ step (which does fire on its own) a chance to
    // settle, then confirm the spent-check result box is still absent —
    // only a click on its own button may produce it.
    await expect(page.locator('.token-verify-result')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.token-spent .token-verify-result')).toHaveCount(0)

    const spentBtn = page.getByRole('button', { name: /Check if spent/ })
    await expect(spentBtn).toBeVisible()
    await expect(spentBtn).toBeEnabled()
  })

  test('Check if spent surfaces a clear error without breaking the rest of the UI when the mint is unreachable', async ({ page }) => {
    // /v1/keysets and /v1/keys aren't mocked (same setup as the DLEQ
    // unreachable test above), so wallet.loadMint() fails — must be reported
    // as a checkstate-specific error, not a crash, and must not clear the
    // token summary already on screen.
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(page.locator('.token-result-grid')).toBeVisible()

    // CSP blocks the mint fetch before it ever reaches the network layer (same as
    // the DLEQ "Could not reach mint" test above), so the failure can resolve too
    // fast to reliably observe the "Checking…" transient — assert the settled
    // state instead, same tradeoff the existing DLEQ unreachable test makes.
    const spentBtn = page.getByRole('button', { name: /Check if spent|Checking with mint/ })
    await spentBtn.click()

    const spentResult = page.locator('.token-spent .token-verify-result')
    await expect(spentResult).toBeVisible({ timeout: 15_000 })
    await expect(spentResult).toContainText(/Could not check spent status/)
    await expect(spentResult).toHaveClass(/tv-unknown/)

    // Rest of the inspector stays intact.
    await expect(page.locator('.token-result-grid')).toBeVisible()
    await expect(spentBtn).toBeEnabled()
    await expect(spentBtn).toHaveText('Check if spent')
  })

  test('Token Inspector shows an error for an invalid token (no crash)', async ({ page }) => {
    await page.locator('.token-input').fill('this-is-not-a-cashu-token')
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-error')).toBeVisible()
    await expect(page.locator('.token-error')).toContainText(/Not a Cashu token/)
    // No result grid is rendered for an invalid token.
    await expect(page.locator('.token-result-grid')).toHaveCount(0)
  })

  test('Token Inspector states exactly what stays local and what contacts the mint', async ({ page }) => {
    await expect(page.locator('.token-note').first()).toHaveText(
      "Decoded in your browser. MintRadar's servers never see your token. Checking contacts the mint named in the token."
    )
    await expect(page.getByPlaceholder('cashuB… or cashuA…')).toBeVisible()
    await expect(page.locator('.tool-subtitle', { hasText: 'Paste a Cashu token (cashuA or cashuB)' })).toBeVisible()
  })

  test('Empty input: Inspect is disabled with a "Paste a token first" hint', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Inspect & Verify Token' })
    await expect(btn).toBeDisabled()
    await expect(page.locator('.token-hint')).toHaveText('Paste a token first')

    await page.locator('.token-input').fill(makeCashuToken(MOCK_MINTS[0]!.url, [21]))
    await expect(btn).toBeEnabled()
    await expect(page.locator('.token-hint')).toHaveCount(0)
  })

  test('Whitespace and line breaks inside the token are stripped before parsing and in the wallet links', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21])
    const wrapped = `  ${token.slice(0, 30)}\n${token.slice(30, 60)} \t${token.slice(60)}\n`

    await page.locator('.token-input').fill(wrapped)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-result-grid')).toContainText('Alpha Mint')
    await expect(page.getByRole('link', { name: /Open in cashu.me/ }))
      .toHaveAttribute('href', `https://wallet.cashu.me/?token=${encodeURIComponent(token)}`)
    await expect(page.getByRole('link', { name: /Redeem to Lightning/ }))
      .toHaveAttribute('href', `https://redeem.cashu.me/?token=${encodeURIComponent(token)}`)
    await expect(page.getByText('These open cashu.me with your full token in the link.')).toBeVisible()
  })

  test('Check if spent explains itself under the button and is accented; the other actions are quiet', async ({ page }) => {
    await page.locator('.token-input').fill(makeCashuToken(MOCK_MINTS[0]!.url, [21]))
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(page.locator('.token-result-grid')).toBeVisible()

    const caption = page.locator('.token-spent-caption')
    await expect(caption).toHaveText('Asks the mint. It will see that you checked.')
    const spentBox = (await page.getByRole('button', { name: /Check if spent/ }).boundingBox())!
    const capBox = (await caption.boundingBox())!
    expect(capBox.y).toBeGreaterThanOrEqual(spentBox.y + spentBox.height)
    await expect(page.getByRole('button', { name: /Check if spent/ })).toHaveClass(/token-action-accent/)
    await expect(page.getByRole('link', { name: /Redeem to Lightning/ })).not.toHaveClass(/token-action-accent/)
    await expect(page.getByRole('link', { name: /Open in cashu.me/ })).toHaveClass(/token-action-btn/)
    await expect(page.getByRole('link', { name: /Open in cashu.me/ })).not.toHaveClass(/token-action-accent/)
    await expect(page.getByRole('button', { name: /View Mint Detail/ })).toHaveClass(/token-action-btn/)
  })

  test.describe('Action flow follows the spent check', () => {
    const MINT = MOCK_MINTS[0]!.url
    const inspect = async (page: import('@playwright/test').Page, checkstate: 'UNSPENT' | 'SPENT') => {
      const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }, { amount: 2, dleq: 'valid' }])
      await serveMintInPage(page, fx, { checkstate })
      await page.reload()
      await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()
      await page.locator('.token-input').fill(fx.token)
      await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
      await expect(page.locator('.token-result-grid')).toBeVisible()
    }

    test('accent moves from Check to Redeem after an unspent result; caption gives way to the result', async ({ page }) => {
      await inspect(page, 'UNSPENT')
      const check = page.getByRole('button', { name: /Check if spent/ })
      const redeem = page.getByRole('link', { name: /Redeem to Lightning/ })
      await expect(check).toHaveClass(/token-action-accent/)
      await expect(redeem).not.toHaveClass(/token-action-accent/)
      await expect(page.locator('.token-spent-caption')).toBeVisible()

      await check.click()
      await expect(page.locator('.token-spent .token-verify-result')).toContainText(/unspent/, { timeout: 15_000 })
      await expect(check).not.toHaveClass(/token-action-accent/)
      await expect(redeem).toHaveClass(/token-action-accent/)
      await expect(page.locator('.token-spent-caption')).toHaveCount(0)
    })

    test('all-spent: Redeem is a disabled non-link, Open in cashu.me is hidden, note says nothing left', async ({ page }) => {
      await inspect(page, 'SPENT')
      await page.getByRole('button', { name: /Check if spent/ }).click()
      await expect(page.locator('.token-spent .token-verify-result')).toContainText(/already spent/, { timeout: 15_000 })

      await expect(page.getByRole('link', { name: /Redeem to Lightning/ })).toHaveCount(0)
      const redeem = page.locator('.token-actions [aria-disabled="true"]', { hasText: 'Redeem to Lightning' })
      await expect(redeem).toBeVisible()
      expect(await redeem.getAttribute('href')).toBeNull()
      await expect(page.getByRole('link', { name: /Open in cashu.me/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /View Mint Detail/ })).toBeVisible()
      await expect(page.getByText('Nothing left to redeem.')).toBeVisible()
      await expect(page.getByText('These open cashu.me with your full token in the link.')).toHaveCount(0)
      await expect(page.locator('.token-action-accent')).toHaveCount(0)
    })
  })

  test('the offline line shows only for an offline tracked mint', async ({ page }) => {
    const line = page.getByText("This mint didn't answer its last check, so checking or redeeming may not work.")
    const input = page.locator('.token-input')
    const go = page.getByRole('button', { name: 'Inspect & Verify Token' })

    await input.fill(makeCashuToken(MOCK_MINTS[2]!.url, [21])) // Charlie Mint: tracked, offline
    await go.click()
    await expect(page.locator('.token-result-grid')).toContainText('Offline')
    await expect(line).toBeVisible()

    await input.fill(makeCashuToken(MOCK_MINTS[0]!.url, [21])) // Alpha Mint: tracked, online
    await go.click()
    await expect(page.locator('.token-result-grid')).toContainText('Online')
    await expect(line).toHaveCount(0)

    await input.fill(makeCashuToken('https://untracked.mint.example', [21])) // not in the database
    await go.click()
    await expect(page.locator('.token-result-grid')).toContainText('Not in database')
    await expect(line).toHaveCount(0)
  })

  test('a currency-symbol amount does not repeat the unit label; sat keeps it', async ({ page }) => {
    const amount = page.locator('.token-result-cell', { hasText: 'Amount' })
    await page.locator('.token-input').fill(makeCashuToken(MOCK_MINTS[0]!.url, [1], 'usd'))
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(amount).toContainText('$0.01')
    await expect(amount.locator('.trc-sub')).toHaveCount(0)

    await page.locator('.token-input').fill(makeCashuToken(MOCK_MINTS[0]!.url, [21]))
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(amount.locator('.trc-sub')).toHaveText('sat')
  })

  test('Token Inspector action buttons are content-sized on desktop; Check if spent is full width at 390px', async ({ page }) => {
    await page.locator('.token-input').fill(makeCashuToken(MOCK_MINTS[0]!.url, [21]))
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
    await expect(page.locator('.token-result-grid')).toBeVisible()

    const card = page.locator('.tool-card').filter({ has: page.locator('.token-input') })
    const inspect = page.getByRole('button', { name: 'Inspect & Verify Token' })
    const spent = page.getByRole('button', { name: /Check if spent/ })
    const redeem = page.getByRole('link', { name: /Redeem to Lightning/ })
    const width = async (l: typeof inspect) => (await l.boundingBox())!.width

    await page.setViewportSize({ width: 1440, height: 900 })
    const cardW = (await card.boundingBox())!.width
    for (const b of [inspect, spent, redeem]) expect(await width(b)).toBeLessThan(cardW * 0.6)
    // Primary button is centered in the card on desktop (like "Find my mint").
    const cb = (await card.boundingBox())!
    const ib = (await inspect.boundingBox())!
    expect(Math.abs(ib.x + ib.width / 2 - (cb.x + cb.width / 2))).toBeLessThan(2)

    await page.setViewportSize({ width: 390, height: 844 })
    const mobileCardW = (await card.boundingBox())!.width
    expect(await width(spent)).toBeGreaterThan(mobileCardW * 0.85)
  })

  test.describe('Signature check states (real DLEQ proofs against an in-page fake mint)', () => {
    const MINT = MOCK_MINTS[0]!.url
    const v: DleqKind = 'valid'
    const none: DleqKind = 'none'
    const bad: DleqKind = 'tampered'
    const cases: { name: string; proofs: DleqKind[]; hideKeys?: boolean; text: RegExp; cls: RegExp; notText?: RegExp }[] = [
      { name: 'every proof verifies → green "Verified"', proofs: [v, v], text: /Verified\. Every proof is signed by this mint\. This doesn't show whether it's spent\./, cls: /tv-ok/ },
      { name: 'only some proofs carry DLEQ → neutral "Partly verified", never red', proofs: [v, none], text: /Partly verified\. 1 of 2 proofs carry signature proofs and those check out\. The rest can't be checked\./, cls: /tv-neutral/, notText: /Invalid signature/ },
      { name: 'no proof carries DLEQ → neutral "can\'t be checked"', proofs: [none, none], text: /Signatures can't be checked\. This token has no signature proofs attached\. That doesn't mean it's bad\./, cls: /tv-neutral/, notText: /issuing mint/ },
      { name: 'a present DLEQ that fails → red "Invalid signature"', proofs: [v, bad], text: /Invalid signature/, cls: /tv-bad/ },
      { name: 'keyset without keys → copper "Couldn\'t check", never red', proofs: [v], hideKeys: true, text: /Couldn't check signatures\. Says nothing about the token itself\./, cls: /tv-unknown/, notText: /Invalid signature/ },
    ]
    for (const c of cases) {
      test(c.name, async ({ page }) => {
        const fx = makeDleqMint(MINT, c.proofs.map((dleq, i) => ({ amount: 2 ** i, dleq })), { hideKeys: c.hideKeys })
        await serveMintInPage(page, fx)
        await page.reload()
        await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()

        await page.locator('.token-input').fill(fx.token)
        await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

        const result = page.locator('.token-verify .token-verify-result')
        await expect(result).toContainText(c.text, { timeout: 15_000 })
        await expect(result).toHaveClass(c.cls)
        if (c.notText) await expect(result).not.toContainText(c.notText)
      })
    }

    test('spent check where every proof is pending says so, not "partially usable"', async ({ page }) => {
      const fx = makeDleqMint(MINT, [{ amount: 1, dleq: v }, { amount: 2, dleq: v }])
      await serveMintInPage(page, fx, { checkstate: 'PENDING' })
      await page.reload()
      await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()

      await page.locator('.token-input').fill(fx.token)
      await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()
      await expect(page.locator('.token-result-grid')).toBeVisible()
      await page.getByRole('button', { name: /Check if spent/ }).click()

      const spent = page.locator('.token-spent .token-verify-result')
      await expect(spent).toContainText(/All 2 proofs pending — the mint is still processing them/, { timeout: 15_000 })
      await expect(spent).not.toContainText(/partially usable/)
      await expect(spent).toHaveClass(/tv-neutral/)
    })
  })

  test('Best Mint Wizard shows the helper line and no endorsement disclaimer', async ({ page }) => {
    await expect(page.locator('.wizard-disclaimer')).toHaveCount(0)
    await expect(page.locator('.tool-card', { hasText: 'Best Mint for Me' }).locator('.tool-subtitle'))
      .toContainText("we'll recommend the best mints for your needs")
  })

  test('Best Mint Wizard result rows use the card Reliability formatting (shield + "Reliability N")', async ({ page }) => {
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    const firstRow = page.locator('.wizard-rec-row').first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    await expect(firstRow.locator('.wizard-rec-reliability')).toContainText(/^Reliability \d+$/)
    await expect(firstRow.locator('.wizard-rec-reliability svg')).toBeVisible() // the shield
    await expect(firstRow.locator('.wizard-rec-score')).toHaveCount(0)    // no bare "NN%"
  })

  test('Best Mint Wizard walks through its questions and recommends mints', async ({ page }) => {
    // Step 1 — currency, then how much to store (the latter auto-advances to step 2).
    await expect(page.getByRole('radiogroup', { name: 'Currency unit' })).toBeVisible()
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    // Step 2 — what matters (multi-select, does not auto-advance).
    await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()

    await page.getByRole('button', { name: /Find my mint/ }).click()

    // Recommendations are computed from the mocked known mints.
    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row')).not.toHaveCount(0)

    // Per-unit NUT-04/05 limits come from the selected unit's method entries.
    await expect(page.locator('.wizard-rec-limits').first()).toContainText('1–1M sat')
    await expect(page.locator('.wizard-rec-limits').first()).toContainText('1–500k sat')
    // ...and the whole-mint caveat is spelled out next to them.
    await expect(page.locator('.wizard-rec-note')).toContainText('reflects the whole mint')
  })

  test('Best Mint Wizard offers only the units online mints actually advertise', async ({ page }) => {
    // Alpha/Bravo/Delta are online and advertise sat + usd; offline Charlie has none.
    const options = page.getByRole('radiogroup', { name: 'Currency unit' }).getByRole('radio')
    await expect(options).toHaveText(['SAT', 'USD'])
  })

  test('Best Mint Wizard excludes mints that do not issue the chosen unit', async ({ page }) => {
    // Only Bravo advertises usd. The shared fixture keeps Bravo's discoveredAt at
    // 10 days ago (needed elsewhere for the "New" badge test), which would now trip
    // the wizard's 14-day recommendation age gate — override it here so this test
    // still isolates unit-filtering behavior, not the age gate.
    await page.route('**/api/mints/known', route => {
      const mints = MOCK_KNOWN_MINTS.map(m =>
        m.name === 'Bravo Mint' ? { ...m, discoveredAt: new Date(Date.now() - 30 * 86_400_000).toISOString() } : m
      )
      route.fulfill({ json: mints })
    })
    await page.reload()
    await expect(page.locator('.tool-title', { hasText: 'Token Inspector' })).toBeVisible()

    await page.getByRole('radio', { name: 'USD', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    await expect(page.locator('.wizard-rec-row')).toHaveCount(1)
    await expect(page.locator('.wizard-rec-row')).toContainText('Bravo Mint')
  })

  test('Best Mint Wizard excludes mints younger than 14 days (recommendation age gate)', async ({ page }) => {
    // Bravo is 10 days old in the shared fixture — below MIN_RECOMMENDATION_AGE_DAYS — so
    // for sat (Alpha/Bravo/Delta all advertise it) it must never appear as a recommendation,
    // and since only 2 of the 3 sat mints are old enough, a "fewer than 3" note shows.
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row')).toHaveCount(2)
    await expect(page.locator('.wizard-rec-row', { hasText: 'Bravo Mint' })).toHaveCount(0)
    await expect(page.locator('.wizard-rec-count-note')).toContainText('Only 2 matching mints found')
  })

  test('Best Mint Wizard shows a clear empty state when zero candidates match', async ({ page }) => {
    // usd is only advertised by Bravo, which is too young (10d) for the age gate.
    await page.getByRole('radio', { name: 'USD', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    await expect(page.locator('.wizard-no-results')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row')).toHaveCount(0)
  })

  test('Best Mint Wizard "What matters" step is multi-select and disables Find until something is checked', async ({ page }) => {
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()

    const findBtn = page.getByRole('button', { name: /Find my mint/ })
    await expect(findBtn).toBeDisabled()

    const fastOpt = page.locator('.wizard-opt', { hasText: 'Fast from here' })
    const reliableOpt = page.locator('.wizard-opt', { hasText: 'Reliable' })
    await fastOpt.click()
    await expect(findBtn).toBeEnabled()
    await expect(fastOpt).toHaveClass(/active/)

    // Both stay checked at once — this is a multi-select, not the old single-select preference.
    await reliableOpt.click()
    await expect(fastOpt).toHaveClass(/active/)
    await expect(reliableOpt).toHaveClass(/active/)

    // Unchecking everything disables Find again.
    await fastOpt.click()
    await reliableOpt.click()
    await expect(findBtn).toBeDisabled()
  })

  test('Best Mint Wizard "What matters" step hides advanced options behind a disclosure', async ({ page }) => {
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()

    for (const name of ['Fast from here', 'Reliable', 'Lightning in and out'])
      await expect(page.locator('.wizard-opt', { hasText: name })).toBeVisible()
    const toggle = page.getByRole('button', { name: 'Advanced options' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.wizard-opt', { hasText: 'Restore from seed' })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['Restore from seed', 'Locked payments', 'Live updates'])
      await expect(page.locator('.wizard-opt', { hasText: name })).toBeVisible()
  })

  test('Best Mint Wizard shows "· N selected" on the Advanced toggle and a "Pick at least one" hint', async ({ page }) => {
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await expect(page.locator('.wizard-hint')).toHaveText('Pick at least one')

    await page.getByRole('button', { name: 'Advanced options' }).click()
    await page.locator('.wizard-opt', { hasText: 'Restore from seed' }).click()
    await expect(page.locator('.wizard-hint')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Advanced options · 1 selected' })).toBeVisible()

    await page.locator('.wizard-opt', { hasText: 'Locked payments' }).click()
    await expect(page.getByRole('button', { name: 'Advanced options · 2 selected' })).toBeVisible()

    // Collapsing keeps the count, so a selected filter is never silently hidden.
    await page.getByRole('button', { name: /Advanced options/ }).click()
    await expect(page.getByRole('button', { name: 'Advanced options · 2 selected' })).toHaveAttribute('aria-expanded', 'false')
  })

  test('Best Mint Wizard "Live updates" (WebSocket) filter excludes mints without NUT-17', async ({ page }) => {
    // Fixture: Alpha (nutCount 12) and Delta (14) advertise NUT-17; Bravo (8) does not.
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.getByRole('button', { name: /Advanced options/ }).click()
    await page.locator('.wizard-opt', { hasText: 'Live updates' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row', { hasText: 'Bravo Mint' })).toHaveCount(0)
  })

  test('Best Mint Wizard "Reliable" checkbox weights results toward Reliability Score', async ({ page }) => {
    await page.getByRole('radio', { name: 'SAT', exact: true }).click()
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Reliable' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    // Alpha has the highest Reliability Score (92) among sat mints old enough for the
    // age gate (Alpha 92, Delta 78) — weighting toward reliability alone should rank it first.
    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row').first()).toContainText('Alpha Mint')
  })
})

test.describe('Tools wizard on touch', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test('Best Mint Wizard: a tapped-then-deselected card does not keep a sticky hover border', async ({ page }) => {
    await page.getByRole('radio', { name: 'SAT', exact: true }).tap()
    await page.locator('.wizard-opt', { hasText: 'Small' }).tap()

    const card = page.locator('.wizard-opt', { hasText: 'Lightning in and out' })
    const untouched = page.locator('.wizard-opt', { hasText: 'Reliable' })
    const border = (l: typeof card) => l.evaluate(el => getComputedStyle(el).borderTopColor)
    const unselected = await border(untouched)

    await card.tap()
    await expect(card).toHaveClass(/active/)
    expect(await border(card)).not.toBe(unselected)

    await card.tap()
    await expect(card).not.toHaveClass(/active/)
    expect(await border(card)).toBe(unselected)
  })

  test('Best Mint Wizard: size labels follow the selected currency', async ({ page }) => {
    const small = page.locator('.wizard-opt', { hasText: 'Small' })
    await expect(small).toContainText('< 10k sats')
    await page.getByRole('radio', { name: 'USD', exact: true }).tap()
    await expect(small).toContainText('< ~$10')
    await expect(page.locator('.wizard-opt', { hasText: 'Large' })).toContainText('> ~$100')
    await expect(page.locator('.wizard-opt', { hasText: 'Large' })).not.toContainText('sats')
  })
})
