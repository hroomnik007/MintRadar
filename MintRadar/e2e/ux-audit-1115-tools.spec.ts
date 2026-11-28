import { test, expect, type Page } from '@playwright/test'
import { installApiMocks, mockRelays, makeDleqMint, makeCashuTokenV4, serveMintInPage, MOCK_MINTS, MOCK_KNOWN_MINTS } from './fixtures/mocks'

// UI/UX audit fixes, Tools (2026-11-15): wizard results scrolled into view, segmented labels never broken mid-word,
// an unknown keyset warned about and the unspent line kept neutral unless the signatures verified, a neutral
// disabled primary button, and one latency per wizard row.

const MINT = MOCK_MINTS[0]!.url

async function openTools(page: Page, size: [number, number] = [1280, 900]) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.setViewportSize({ width: size[0], height: size[1] })
  await page.goto('/tools')
  await expect(page.locator('.tool-title', { hasText: 'Token inspector' })).toBeVisible()
}

test.describe('Token inspector: how sure the spent line sounds', () => {
  const inspectAndCheck = async (page: Page, fx: ReturnType<typeof makeDleqMint>, token: string) => {
    await serveMintInPage(page, { ...fx, token }, { checkstate: 'UNSPENT' })
    await page.reload()
    await expect(page.locator('.tool-title', { hasText: 'Token inspector' })).toBeVisible()
    await page.locator('.token-input').fill(token)
    await page.getByRole('button', { name: 'Inspect token' }).click()
    await expect(page.getByTestId('token-verify-source')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Check if spent/ }).click()
    // Review 2026-11-28 (T1): the spent answer is the result block at the top.
    return page.locator('[data-testid="token-verdict"][data-checked="true"]')
  }

  test('verified signatures from a listed keyset: the green "not redeemed yet" line, no keyset warning', async ({ page }) => {
    await openTools(page)
    const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }, { amount: 2, dleq: 'valid' }])
    const line = await inspectAndCheck(page, fx, fx.token)
    await expect(line).toBeVisible({ timeout: 15_000 })
    // Second pass 2026-11-28: the spent state is its own chip, green only with confirmed signatures.
    await expect(page.getByTestId('token-spent-chip')).toHaveText('Not spent')
    await expect(page.getByTestId('token-spent-chip')).toHaveClass(/tvd-chip-ok/)
    await expect(page.getByTestId('token-sig-chip')).toHaveText('Signed by Alpha Mint')
    await expect(page.getByTestId('token-unknown-keyset')).toHaveCount(0)
  })

  test('no signature proofs: the unspent line is neutral and only says what the mint answered', async ({ page }) => {
    await openTools(page)
    const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'none' }, { amount: 2, dleq: 'none' }])
    const line = await inspectAndCheck(page, fx, fx.token)
    await expect(line).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('token-spent-chip')).toHaveText('Not spent')
    await expect(line).toContainText('The mint has not marked these coins as spent.')
    await expect(page.getByTestId('token-spent-chip')).toHaveClass(/tvd-chip-neutral/)
    await expect(line).toHaveClass(/tvd-neutral/)
    await expect(page.getByTestId('token-unknown-keyset')).toHaveCount(0)
  })

  test('a keyset the mint does not list: a prominent warning, and the unspent line stays neutral', async ({ page }) => {
    await openTools(page)
    const fx = makeDleqMint(MINT, [{ amount: 1, dleq: 'valid' }])
    // Proofs from keyset 009a1f293253e41e, which the fixture mint does not list.
    await inspectAndCheck(page, fx, makeCashuTokenV4(MINT, [1, 2]))
    const warn = page.getByTestId('token-unknown-keyset')
    await expect(warn).toBeVisible()
    await expect(warn).toContainText('This mint does not list keyset 009a1f293253e41e. The token may not come from this mint, or may be invalid.')
    await expect(page.getByTestId('token-spent-chip')).toHaveText('Not spent', { timeout: 15_000 })
    await expect(page.getByTestId('token-spent-chip')).not.toHaveClass(/tvd-chip-ok/)
    // Above the details table with the fee row.
    const wBox = (await warn.boundingBox())!
    const feeBox = (await page.getByTestId('token-claim-fee').boundingBox())!
    expect(wBox.y).toBeLessThan(feeBox.y)
    await expect(page.getByTestId('token-details')).not.toContainText(/trust/i)
  })
})

test('disabled primary buttons are faded copper (owner, 2026-11-19 mockup), never green, and keep their height when enabled', async ({ page }) => {
  await openTools(page)
  const btn = page.getByRole('button', { name: 'Inspect token' })
  await expect(btn).toBeDisabled()
  const off = await btn.evaluate(el => { const cs = getComputedStyle(el); return { op: cs.opacity, bg: cs.backgroundColor, h: el.getBoundingClientRect().height } })
  expect(off.op).toBe('0.45')
  const color = (v: string) => page.evaluate(x => { const d = document.createElement('div'); d.style.color = x; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c }, v)
  expect(off.bg).not.toBe(await color('var(--accent)'))
  expect(off.bg).toBe(await color('var(--action)'))
  await page.locator('.token-input').fill('cashuBxyz')
  await expect(btn).toBeEnabled()
  const onH = await btn.evaluate(el => el.getBoundingClientRect().height)
  expect(onH).toBe(off.h)
})

// ── Wizard ──
const base = MOCK_KNOWN_MINTS[0]!
const OLD = new Date(Date.now() - 400 * 86_400_000).toISOString()
const mk = (id: string, version: string, score: number) => ({ ...base, url: `https://${id}.mint.example`, name: `${id[0]!.toUpperCase()}${id.slice(1)} Mint`, version, reliabilityScore: score, discoveredAt: OLD, online: true, lastCheckedAt: new Date().toISOString(), units: ['sat'] })
const KNOWN = [mk('alpha', 'Nutshell/0.16.0', 92), mk('delta', 'cdk-mintd/0.9.1', 90), mk('echo', 'LekMint/0.17.0', 80), mk('foxtrot', 'Moksha/0.9.0', 70)]

async function openWizard(page: Page, size: [number, number]) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route('**/api/mints/known', r => r.fulfill({ json: KNOWN }))
  // The dev CSP blocks real mint fetches, so /v1/info is answered in the page (as in tools-wizard-b2.spec.ts).
  await page.addInitScript(() => {
    const real = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (!/^https:\/\/[a-z]+\.mint\.example\/v1\/info$/.test(url)) return real(input, init)
      return new Promise<Response>(resolve => setTimeout(() => resolve(new Response(JSON.stringify({ name: 'Mint', nuts: {} }), { status: 200 })), 30))
    }
  })
  await page.setViewportSize({ width: size[0], height: size[1] })
  await page.goto('/tools')
  await expect(page.getByRole('radio', { name: 'SAT', exact: true })).toBeVisible()
  await page.getByRole('radio', { name: 'SAT', exact: true }).click()
  await page.locator('.wizard-opt', { hasText: 'Small' }).click()
}

for (const size of [[390, 844], [1280, 800]] as [number, number][]) {
  test(`${size[0]}px: after Find my mint the results are scrolled into view and their heading has focus`, async ({ page }) => {
    await openWizard(page, size)
    await page.locator('.wizard-opt', { hasText: 'Reliable' }).click()
    await page.getByRole('button', { name: /Find my mint/ }).click()
    await expect(page.locator('.wizard-rec-row').first()).toBeVisible()
    await expect(page.getByTestId('wizard-results-heading')).toBeFocused()
    // Scrolled until the results sit just below the sticky navbar, or as far as the page goes.
    await expect.poll(async () => page.getByTestId('wizard-results').evaluate(el => {
      const top = el.getBoundingClientRect().top
      const nav = document.querySelector('.navbar')!.getBoundingClientRect().bottom
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
      return (top >= nav && top <= nav + 24) || (atEnd && top >= nav && top <= window.innerHeight / 2)
    }), { timeout: 5000 }).toBe(true)
    const firstRow = (await page.locator('.wizard-rec-row').first().boundingBox())!
    expect(firstRow.y + firstRow.height).toBeLessThanOrEqual(size[1])
  })
}

test('latency appears once per row: in the reason line when speed was asked for, else in the meta line', async ({ page }) => {
  await openWizard(page, [1280, 800])
  await page.locator('.wizard-opt', { hasText: 'Fast from here' }).click()
  await page.getByRole('button', { name: /Find my mint/ }).click()
  const row = page.locator('.wizard-rec-row').first()
  await expect(row).toBeVisible()
  await expect(row.locator('.wizard-rec-facts')).toContainText(/\d+ ms from your browser/)
  expect((await row.innerText()).match(/ms/g)?.length).toBe(1)

  await page.getByRole('button', { name: /Start over/ }).click()
  await page.getByRole('radio', { name: 'SAT', exact: true }).click()
  await page.locator('.wizard-opt', { hasText: 'Small' }).click()
  await page.locator('.wizard-opt', { hasText: 'Reliable' }).click()
  await page.getByRole('button', { name: /Find my mint/ }).click()
  const row2 = page.locator('.wizard-rec-row').first()
  await expect(row2.locator('.wizard-rec-meta')).toContainText(/\d+ ms from your browser/)
  expect((await row2.innerText()).match(/ms/g)?.length).toBe(1)
})

for (const width of [390, 700, 760, 901, 960, 1020, 1100, 1280, 1440]) {
  test(`${width}px: advanced segmented labels are never broken mid-word and stay inside their control`, async ({ page }) => {
    await openWizard(page, [width, 900])
    await page.locator('.wizard-adv-toggle').click()
    for (const group of ['Preferred software', 'Max latency (measured from your browser)']) {
      const seg = page.getByRole('radiogroup', { name: group })
      await expect(seg).toBeVisible()
      const bad = await seg.evaluate(el => {
        const out: string[] = []
        const segBox = el.getBoundingClientRect()
        const card = el.closest('.wizard-opt-group')!.getBoundingClientRect()
        if (segBox.right > card.right + 0.5) out.push(`control overflows its card by ${segBox.right - card.right}`)
        for (const b of Array.from(el.querySelectorAll('button'))) {
          if (b.scrollWidth > b.clientWidth + 1) out.push(`${b.textContent} overflows`)
          // Each word on one line: a word broken mid-way makes a text line narrower than the widest word.
          const range = document.createRange()
          const node = b.firstChild!
          for (const m of b.textContent!.matchAll(/\S+/g)) {
            range.setStart(node, m.index!); range.setEnd(node, m.index! + m[0].length)
            if (range.getClientRects().length > 1) out.push(`"${m[0]}" broken`)
          }
        }
        return out
      })
      expect(bad, group).toEqual([])
    }
  })
}
