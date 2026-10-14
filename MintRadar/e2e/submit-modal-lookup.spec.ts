import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { installApiMocks } from './fixtures/mocks'
import { flush } from './fixtures/settle'

// Submit modal: a Nostr key lookup (600 ms debounce, then the relays) and the /api/mint/probe preview belong to the
// input value they were started for. A late answer must never overwrite what the user typed afterwards:
// the Submit button submits exactly the URL shown in the preview for the current input.

// A `held` key's announcement is only sent when the test releases it (after the lookup has reached the relay mock),
// an unheld one is answered at once.
interface Key { sk: Uint8Array; npub: string; pk: string; url: string; held: boolean }
const mkKey = (url: string, held: boolean): Key => {
  const sk = generateSecretKey(); const pk = getPublicKey(sk)
  return { sk, npub: nip19.npubEncode(pk), pk, url, held }
}

async function setup(page: Page, keys: Key[]) {
  const events = new Map(keys.map(k => [k.pk, finalizeEvent({ kind: 38172, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'x'], ['u', k.url], ['k', '38172']], content: '' }, k.sk)]))
  const asked = new Set<string>() // keys whose lookup (REQ for kind 38172 by that author) reached the relay mock
  const held = new Map<string, () => void>()
  await page.routeWebSocket(/^wss:\/\//, ws => ws.onMessage(m => {
    let p: unknown
    try { p = JSON.parse(String(m)) } catch { return }
    if (!Array.isArray(p)) return
    if (p[0] === 'REQ') {
      const f = (p[2] ?? {}) as { kinds?: number[]; authors?: string[] }
      const key = keys.find(k => (f.authors ?? []).includes(k.pk))
      if ((f.kinds ?? []).includes(38172) && key) {
        const answer = () => { try { ws.send(JSON.stringify(['EVENT', p[1], events.get(key.pk)])); ws.send(JSON.stringify(['EOSE', p[1]])) } catch { /* the socket was closed by the page */ } }
        asked.add(key.pk)
        if (key.held) held.set(key.pk, answer); else answer()
      } else ws.send(JSON.stringify(['EOSE', p[1]]))
    } else if (p[0] === 'EVENT') ws.send(JSON.stringify(['OK', (p[1] as { id: string }).id, true, '']))
  }))
  await installApiMocks(page)
  const sent: string[] = []; const probed: string[] = []
  await page.route('**/api/mint/submit', r => { sent.push((JSON.parse(r.request().postData()!) as { url: string }).url); r.fulfill({ json: { success: true, isNew: true } }) })
  await page.route('**/api/mint/probe**', r => {
    const u = new URL(r.request().url()).searchParams.get('url')!
    probed.push(u)
    r.fulfill({ json: { url: u, online: true, latencyMs: 40, info: { name: `Probe ${u}`, version: 'x', nuts: {} } } })
  })
  await page.goto('/')
  await expect(page.locator('.mint-card').first()).toBeVisible()
  await page.locator('.submit-btn').click()
  await expect(page.locator('.submit-modal')).toBeVisible()
  return {
    sent, probed,
    /** The lookup for this key is in flight at the relay mock (the debounce is over and the REQ was sent). */
    inFlight: (k: Key) => expect.poll(() => asked.has(k.pk), { message: 'the lookup reached the relay' }).toBe(true),
    /** Sends the held announcement (only once its REQ has arrived), then lets the page process it. */
    release: async (k: Key) => {
      await expect.poll(() => held.has(k.pk), { message: 'the held announcement is waiting at the relay mock' }).toBe(true)
      held.get(k.pk)!()
      await flush(page)
    },
  }
}

test('a late lookup result does not overwrite a URL typed afterwards', async ({ page }) => {
  const a = mkKey('https://announced.mint.example', true)
  const { sent, probed, inFlight, release } = await setup(page, [a])
  const input = page.locator('.submit-modal-input')
  await input.fill(a.npub)
  await inFlight(a)
  await input.fill('https://typed.mint.example')
  await expect(page.locator('.submit-probe-name')).toHaveText('Probe https://typed.mint.example')
  await release(a) // the late announcement arrives now
  await expect(input).toHaveValue('https://typed.mint.example')
  await expect(page.locator('.submit-probe-name')).toHaveText('Probe https://typed.mint.example')
  await page.locator('.submit-ok-btn:not([aria-disabled="true"])').click()
  await expect(page.locator('.submit-result.success')).toBeVisible()
  expect(sent).toEqual(['https://typed.mint.example'])
  expect(probed).not.toContain('https://announced.mint.example')
})

test('changing the key twice quickly: only the current key\'s mint is previewed and submitted', async ({ page }) => {
  const slow = mkKey('https://slow.mint.example', true)
  const fast = mkKey('https://fast.mint.example', false)
  const { sent, probed, inFlight, release } = await setup(page, [slow, fast])
  const input = page.locator('.submit-modal-input')
  await input.fill(slow.npub)
  await inFlight(slow)
  await input.fill(fast.npub)
  await expect(page.locator('.submit-probe-name')).toHaveText('Probe https://fast.mint.example')
  await release(slow) // the slow announcement arrives after the fast one
  await expect(page.locator('.submit-probe-name')).toHaveText('Probe https://fast.mint.example')
  await page.locator('.submit-ok-btn:not([aria-disabled="true"])').click()
  await expect(page.locator('.submit-result.success')).toBeVisible()
  expect(sent).toEqual(['https://fast.mint.example'])
  expect(probed).not.toContain('https://slow.mint.example')
})

test('a lookup that returns after the modal was closed changes nothing and logs no error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const a = mkKey('https://announced.mint.example', true)
  const { probed, inFlight, release } = await setup(page, [a])
  await page.locator('.submit-modal-input').fill(a.npub)
  await inFlight(a)
  await page.keyboard.press('Escape')
  await expect(page.locator('.submit-modal')).toHaveCount(0)
  await release(a) // the announcement arrives while the modal is closed
  expect(probed).toEqual([])      // no probe for the late result
  await page.locator('.submit-btn').click()
  await expect(page.locator('.submit-modal-input')).toHaveValue('') // reopened clean
  await expect(page.locator('.submit-probe-name')).toHaveCount(0)
  await expect(page.locator('.submit-ok-btn')).toBeDisabled()
  expect(errors.filter(e => !/Failed to load resource|favicon/i.test(e))).toEqual([])
})
