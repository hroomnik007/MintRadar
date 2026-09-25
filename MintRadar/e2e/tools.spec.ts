import { test, expect } from '@playwright/test'
import { installApiMocks, mockRelays, makeCashuToken, makeCashuTokenV4, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

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
    const overflowing = await page.locator('.token-action-btn').evaluateAll(
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

  test('Risk badge is Low risk for an online, high-reliability mint', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[0]!.url, [21]) // Alpha: online, reliabilityScore 92

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-risk-badge')).toContainText('Low risk')
  })

  test('Risk badge is High risk for an offline mint', async ({ page }) => {
    const token = makeCashuToken(MOCK_MINTS[2]!.url, [21]) // Charlie: offline

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-risk-badge')).toContainText('High risk')
  })

  test('Risk badge is Unknown for a mint MintRadar has never seen', async ({ page }) => {
    const token = makeCashuToken('https://never-seen.mint.example', [21])

    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-result-cell', { hasText: 'Mint Status' })).toContainText('Not in database')
    await expect(page.locator('.token-risk-badge')).toContainText('Unknown')
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
    await expect(spentBtn).toHaveText('🔍 Check if spent')
  })

  test('Token Inspector shows an error for an invalid token (no crash)', async ({ page }) => {
    await page.locator('.token-input').fill('this-is-not-a-cashu-token')
    await page.getByRole('button', { name: 'Inspect & Verify Token' }).click()

    await expect(page.locator('.token-error')).toBeVisible()
    await expect(page.locator('.token-error')).toContainText(/Not a Cashu token/)
    // No result grid is rendered for an invalid token.
    await expect(page.locator('.token-result-grid')).toHaveCount(0)
  })

  test('Best Mint Wizard shows the helper line and no endorsement disclaimer', async ({ page }) => {
    await expect(page.locator('.wizard-disclaimer')).toHaveCount(0)
    await expect(page.locator('.tool-card', { hasText: 'Best Mint for Me' }).locator('.tool-subtitle'))
      .toContainText('latency measured from your browser')
  })

  test('Best Mint Wizard result rows use the card Reliability formatting (shield + "Reliability N")', async ({ page }) => {
    await page.locator('.wizard-unit-select').selectOption('sat')
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
    await expect(page.locator('.wizard-unit-select')).toBeVisible()
    await page.locator('.wizard-unit-select').selectOption('sat')
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
    const options = page.locator('.wizard-unit-select option')
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

    await page.locator('.wizard-unit-select').selectOption('usd')
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
    await page.locator('.wizard-unit-select').selectOption('sat')
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
    await page.locator('.wizard-unit-select').selectOption('usd')
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    await expect(page.locator('.wizard-no-results')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row')).toHaveCount(0)
  })

  test('Best Mint Wizard "What matters" step is multi-select and disables Find until something is checked', async ({ page }) => {
    await page.locator('.wizard-unit-select').selectOption('sat')
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

  test('Best Mint Wizard "Live updates (WebSocket)" filter excludes mints without NUT-17', async ({ page }) => {
    // Fixture: Alpha (nutCount 12) and Delta (14) advertise NUT-17; Bravo (8) does not.
    await page.locator('.wizard-unit-select').selectOption('sat')
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Live updates (WebSocket)' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row', { hasText: 'Bravo Mint' })).toHaveCount(0)
  })

  test('Best Mint Wizard "Reliable" checkbox weights results toward Reliability Score', async ({ page }) => {
    await page.locator('.wizard-unit-select').selectOption('sat')
    await page.locator('.wizard-opt', { hasText: 'Small' }).click()
    await page.locator('.wizard-opt', { hasText: 'Reliable' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()

    // Alpha has the highest Reliability Score (92) among sat mints old enough for the
    // age gate (Alpha 92, Delta 78) — weighting toward reliability alone should rank it first.
    await expect(page.locator('.wizard-rec-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.wizard-rec-row').first()).toContainText('Alpha Mint')
  })
})
