import { test, expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, TEST_PUBKEY_HEX } from './fixtures/mocks'

// The Vite dev server's CSP is `img-src 'self' data: blob:` (production nginx allows `https:`), so
// remote avatars could never load here — bypass CSP for this file; requests are mocked via page.route.
test.use({ bypassCSP: true })

// Account chip avatar: fixed round slot; image when https + loads, otherwise a tinted
// placeholder with the first grapheme of the name (or a User icon for empty / npub-like names).

const OK_URL = 'https://img.example/ok.png'
const BAD_URL = 'https://img.example/broken.png'
// 1x1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

async function login(page: Page, name: string | null, picture?: string) {
  const npub = nip19.npubEncode(TEST_PUBKEY_HEX)
  await page.addInitScript(({ pubkey, npub, name, picture }) => {
    ;(window as unknown as { nostr: unknown }).nostr = {
      getPublicKey: async () => pubkey,
      signEvent: async (e: Record<string, unknown>) => ({ ...e, id: 'f'.repeat(64), pubkey, sig: '0'.repeat(128) }),
      nip04: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
      nip44: { encrypt: async (_p: string, t: string) => t, decrypt: async (_p: string, t: string) => t },
    }
    sessionStorage.setItem('mintradar_session', JSON.stringify({
      state: { profile: { pubkey, npub, name, picture }, method: 'nip07' }, version: 0,
    }))
  }, { pubkey: TEST_PUBKEY_HEX, npub, name, picture })
}

async function routes(page: Page) {
  await mockRelays(page)
  await installApiMocks(page)
  await page.route(OK_URL, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.route(BAD_URL, r => r.abort())
}

const avatar = (page: Page) => page.locator('.navbar-profile .navbar-avatar')
// 30px from 641px (controls match the tab group height), 22px on the two-row mobile layout.
const boxFor = (width: number) => (width > 640 ? [30, 30] : [22, 22])
const size = async (page: Page) => { const b = (await avatar(page).boundingBox())!; return [Math.round(b.width), Math.round(b.height)] }

async function expectOneRow(page: Page) {
  for (const width of [390, 700, 1100, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await page.reload() // measure a fresh layout at this width, not a live resize
    await avatar(page).waitFor()
    const m = await page.evaluate(() => {
      const a = document.querySelector('.navbar-auth')!.getBoundingClientRect()
      const l = document.querySelector('.nav-logo')!.getBoundingClientRect()
      return { sameRow: Math.abs((a.top + a.height / 2) - (l.top + l.height / 2)) < 6, sw: document.documentElement.scrollWidth - document.documentElement.clientWidth, h: document.querySelector('.navbar-inner')!.getBoundingClientRect().height }
    })
    expect(m.sameRow, `${width}px logo/auth on one row`).toBe(true)
    expect(m.sw, `${width}px overflow`).toBeLessThanOrEqual(0)
    if (width > 640) expect(m.h, `${width}px height`).toBeLessThanOrEqual(56)
    expect(await size(page), `${width}px avatar size`).toEqual(boxFor(width))
  }
}

test('(a) no picture: letter placeholder, fixed size, aria-hidden', async ({ page }) => {
  await routes(page)
  await login(page, 'ørjan')
  await page.goto('/')
  await expect(avatar(page)).toHaveText('Ø')
  await expect(avatar(page)).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('.navbar-profile img')).toHaveCount(0)
  await expectOneRow(page)
})

test('first character is taken by grapheme (emoji with modifier / flag)', async ({ page }) => {
  await routes(page)
  await login(page, '👨‍👩‍👧 family')
  await page.goto('/')
  await expect(avatar(page)).toHaveText('👨‍👩‍👧')
})

for (const [label, name] of [['empty name', ''], ['npub-like name', nip19.npubEncode(TEST_PUBKEY_HEX)], ['null name', null]] as const) {
  test(`${label}: User icon instead of a letter`, async ({ page }) => {
    await routes(page)
    await login(page, name)
    await page.goto('/')
    await expect(avatar(page).locator('svg')).toHaveCount(1)
    expect((await avatar(page).textContent())?.trim()).toBe('')
    expect(await size(page)).toEqual(boxFor(1280))
    await page.setViewportSize({ width: 390, height: 800 })
    await expect(page.locator('.navbar-profile')).toHaveAttribute('aria-label', /^Account: .+/)
  })
}

test('non-https picture: placeholder, no request made for it', async ({ page }) => {
  await routes(page)
  const reqs: string[] = []
  page.on('request', r => { if (r.url().startsWith('http://insecure.example')) reqs.push(r.url()) })
  await login(page, 'Pic User', 'http://insecure.example/a.png')
  await page.goto('/')
  await expect(avatar(page)).toHaveText('P')
  expect(reqs).toEqual([])
})

test('(b) picture request aborted → onError → placeholder, same size, no extra requests', async ({ page }) => {
  await routes(page)
  let hits = 0
  await page.route(BAD_URL, r => { hits++; return r.abort() })
  await login(page, 'Pic User', BAD_URL)
  await page.goto('/')
  await expect(avatar(page)).toHaveText('P')
  await expect(page.locator('.navbar-profile img')).toHaveCount(0)
  expect(await size(page)).toEqual(boxFor(1280))
  expect(hits).toBe(1)
  await expectOneRow(page)
})

test('(c) valid picture: image shown, same size', async ({ page }) => {
  await routes(page)
  await login(page, 'Pic User', OK_URL)
  await page.goto('/')
  await expect(page.locator('.navbar-profile img.navbar-avatar')).toHaveCount(1)
  await expect.poll(() => page.locator('.navbar-profile img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  expect(await size(page)).toEqual(boxFor(1280))
  await expectOneRow(page)
})

test('(d) broken URL replaced by a valid one shows the image again', async ({ page }) => {
  await routes(page)
  await login(page, 'Pic User', BAD_URL)
  await page.goto('/')
  await expect(avatar(page)).toHaveText('P')
  const before = await size(page)
  await page.evaluate(async (url) => {
    // @ts-expect-error — a Vite dev-server URL, resolved in the browser; there is no such file for tsc to find
    const { useAuthStore } = await import('/src/stores/auth.store.ts')
    const p = useAuthStore.getState().profile!
    useAuthStore.setState({ profile: { ...p, picture: url } })
  }, OK_URL)
  await expect(page.locator('.navbar-profile img.navbar-avatar')).toHaveCount(1)
  expect(await size(page)).toEqual(before)
})

test('chip keeps an accessible name with the display name at 390px (visible name hidden)', async ({ page }) => {
  await routes(page)
  await login(page, 'Pic User', BAD_URL)
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  await expect(page.locator('.navbar-username')).toBeHidden()
  await expect(page.locator('.navbar-profile')).toHaveAccessibleName(/Pic User/)
  await expect(page.locator('.navbar-profile')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.navbar-profile')).toHaveAttribute('aria-controls', 'navbar-account-panel')
})
