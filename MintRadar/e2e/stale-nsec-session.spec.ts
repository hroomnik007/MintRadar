import { test, expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { installApiMocks, mockRelays, loginAs, loginAsNsecLive, TEST_PUBKEY_HEX } from './fixtures/mocks'

const NOTICE = 'Your key was cleared when the page reloaded. Log in again to sign.'
const NPUB = nip19.npubEncode(TEST_PUBKEY_HEX)

test.beforeEach(async ({ page }) => {
  await mockRelays(page)
  await installApiMocks(page)
})

// Seeds a persisted session ONCE per tab (a flag stops the init script from
// re-seeding on reload, so "second reload" really sees the post-reset state).
async function seedSessionOnce(page: Page, method: string, extra: Record<string, string> = {}) {
  await page.addInitScript(({ pubkey, npub, method, extra }) => {
    if (sessionStorage.getItem('__e2e_seeded')) return
    sessionStorage.setItem('__e2e_seeded', '1')
    sessionStorage.setItem('mintradar_session', JSON.stringify({ state: { profile: { pubkey, npub, name: 'tester' }, method }, version: 0 }))
    for (const [k, v] of Object.entries(extra)) sessionStorage.setItem(k, v)
  }, { pubkey: TEST_PUBKEY_HEX, npub: NPUB, method, extra })
}

const notice = (page: Page) => page.locator('.session-notice')

test('nsec session seeded without a key loads logged out, shows the notice once, not on the next reload', async ({ page }) => {
  await seedSessionOnce(page, 'nsec')
  await page.goto('/')
  await expect(page.locator('.navbar-login-btn')).toBeVisible()
  await expect(page.locator('.navbar-profile')).toHaveCount(0)
  await expect(notice(page)).toHaveCount(1)
  await expect(notice(page)).toHaveText(`${NOTICE}×`)
  await expect(notice(page)).toHaveAttribute('role', 'status')
  expect(await page.evaluate(() => sessionStorage.getItem('mintradar_session'))).not.toContain('sessionNotice')

  // not repeated on later navigation
  await page.getByRole('link', { name: 'Stats' }).click()
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await expect(notice(page)).toHaveCount(1) // still the same single, undismissed notice

  // dismissible
  await notice(page).getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice(page)).toHaveCount(0)
  await page.getByRole('link', { name: 'Stats' }).click()
  await expect(notice(page)).toHaveCount(0)

  // second reload: the session is already reset, so no notice
  await page.reload()
  await expect(page.locator('.navbar-login-btn')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
})

for (const [w, h, clipH] of [[1440, 900, 220], [390, 844, 260]] as const) {
  test(`notice fits without horizontal overflow at ${w}px (screenshot)`, async ({ page }) => {
    await seedSessionOnce(page, 'nsec')
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await expect(notice(page)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `test-results/stale-nsec-${w}.png`, clip: { x: 0, y: 0, width: w, height: clipH } })
  })
}

test('a fresh nsec login in the same page is not cleared and shows no notice', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.navbar-login-btn')).toBeVisible()
  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await page.locator('.nostr-method-card', { hasText: 'Nostr key (nsec)' }).click()
  await page.locator('.nostr-nsec-input').fill('0'.repeat(63) + '1')
  await page.getByRole('button', { name: 'Connect' }).click()
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await page.getByRole('link', { name: 'Stats' }).click()
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
})

test('nip07 session stays logged in with no notice, even when window.nostr is injected late', async ({ page }) => {
  await seedSessionOnce(page, 'nip07')
  await page.addInitScript(() => {
    setTimeout(() => {
      ;(window as unknown as { nostr: unknown }).nostr = { getPublicKey: async () => '1'.repeat(64), signEvent: async (e: object) => e }
    }, 300)
  })
  await page.goto('/')
  await page.waitForTimeout(800)
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  expect(await page.evaluate(() => typeof (window as unknown as { nostr?: unknown }).nostr)).toBe('object')
})

test('local watchlist entries survive the reset', async ({ page }) => {
  // 1) add a mint to the local watchlist with a normal (nip07) session
  await loginAs(page)
  await page.goto('/?status=all')
  const alpha = page.locator('.mint-card', { has: page.locator('.card-name', { hasText: 'Alpha Mint' }) })
  await alpha.getByRole('button', { name: /^Add .+ to watchlist$/ }).click()
  await expect(alpha.getByRole('button', { name: 'Remove Alpha Mint from watchlist' })).toBeVisible()
  await page.waitForTimeout(500) // let the Dexie write land

  // 2) fresh tab in the same context (shared IndexedDB, own sessionStorage) with a stale nsec session
  const page2 = await page.context().newPage()
  await mockRelays(page2)
  await installApiMocks(page2)
  await seedSessionOnce(page2, 'nsec')
  await page2.goto('/')
  await expect(page2.locator('.navbar-login-btn')).toBeVisible()
  await expect(notice(page2)).toHaveCount(1)
  const count = await page2.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('mintradar-v1')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const req = open.result.transaction('watchlist').objectStore('watchlist').count()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }
  }))
  expect(count).toBe(1)
  // nothing that starts on login ran
  const requests: string[] = []
  page2.on('request', r => { if (r.url().includes('/api/notifications/subscribe')) requests.push(r.url()) })
  await page2.waitForTimeout(800)
  expect(requests).toEqual([])
})

test('remote-signer session with its persisted bunker connection survives the reload (left alone)', async ({ page }) => {
  await seedSessionOnce(page, 'remote-signer', {
    bunkerURI: `bunker://${'2'.repeat(64)}?relay=${encodeURIComponent('wss://relay.example.com')}`,
    bunkerClientSecretKey: '3'.repeat(64),
    bunkerPubkey: TEST_PUBKEY_HEX,
  })
  await page.goto('/')
  await page.waitForTimeout(1000)
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  // the restored signer shim is installed synchronously from the persisted connection
  expect(await page.evaluate(() => (window as unknown as { nostr?: { __mintradarShim?: boolean } }).nostr?.__mintradarShim)).toBe(true)
})

// loginAsNsecLive sanity: the live key path used by other specs does not trip the stale check
test('loginAsNsecLive keeps the session', async ({ page }) => {
  await page.goto('/')
  await loginAsNsecLive(page)
  await expect(page.locator('.navbar-profile')).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
})
