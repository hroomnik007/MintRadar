import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import { installApiMocks } from './fixtures/mocks'

// Submit modal: a Nostr key lookup (600 ms debounce, then the relays) and the /api/mint/probe preview belong to the
// input value they were started for. A late answer must never overwrite what the user typed afterwards:
// the Submit button submits exactly the URL shown in the preview for the current input.

interface Key { sk: Uint8Array; npub: string; pk: string; url: string; delayMs: number }
const mkKey = (url: string, delayMs: number): Key => {
  const sk = generateSecretKey(); const pk = getPublicKey(sk)
  return { sk, npub: nip19.npubEncode(pk), pk, url, delayMs }
}

async function setup(page: Page, keys: Key[]) {
  const events = new Map(keys.map(k => [k.pk, finalizeEvent({ kind: 38172, created_at: Math.floor(Date.now() / 1000), tags: [['d', 'x'], ['u', k.url], ['k', '38172']], content: '' }, k.sk)]))
  await page.routeWebSocket(/^wss:\/\//, ws => ws.onMessage(m => {
    let p: unknown
    try { p = JSON.parse(String(m)) } catch { return }
    if (!Array.isArray(p)) return
    if (p[0] === 'REQ') {
      const f = (p[2] ?? {}) as { kinds?: number[]; authors?: string[] }
      const key = keys.find(k => (f.authors ?? []).includes(k.pk))
      if ((f.kinds ?? []).includes(38172) && key) {
        setTimeout(() => { try { ws.send(JSON.stringify(['EVENT', p[1], events.get(key.pk)])); ws.send(JSON.stringify(['EOSE', p[1]])) } catch { /* page closed */ } }, key.delayMs)
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
  return { sent, probed }
}

test('a late lookup result does not overwrite a URL typed afterwards', async ({ page }) => {
  const a = mkKey('https://announced.mint.example', 2500)
  const { sent, probed } = await setup(page, [a])
  const input = page.locator('.submit-modal-input')
  await input.fill(a.npub)
  await page.waitForTimeout(900) // past the 600 ms debounce: the lookup is in flight, the relay answers at ~3.1 s
  await input.fill('https://typed.mint.example')
  await expect(page.locator('.submit-probe-name')).toHaveText('Probe https://typed.mint.example')
  await page.waitForTimeout(3000) // the late announcement has now arrived
  await expect(input).toHaveValue('https://typed.mint.example')
  await expect(page.locator('.submit-probe-name')).toHaveText('Probe https://typed.mint.example')
  await page.locator('.submit-ok-btn:not([aria-disabled="true"])').click()
  await expect(page.locator('.submit-result.success')).toBeVisible()
  expect(sent).toEqual(['https://typed.mint.example'])
  expect(probed).not.toContain('https://announced.mint.example')
})

test('changing the key twice quickly: only the current key\'s mint is previewed and submitted', async ({ page }) => {
  const slow = mkKey('https://slow.mint.example', 2500)
  const fast = mkKey('https://fast.mint.example', 100)
  const { sent, probed } = await setup(page, [slow, fast])
  const input = page.locator('.submit-modal-input')
  await input.fill(slow.npub)
  await page.waitForTimeout(900)
  await input.fill(fast.npub)
  await expect(page.locator('.submit-probe-name')).toHaveText('Probe https://fast.mint.example')
  await page.waitForTimeout(3000)
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
  const a = mkKey('https://announced.mint.example', 2000)
  const { probed } = await setup(page, [a])
  await page.locator('.submit-modal-input').fill(a.npub)
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')
  await expect(page.locator('.submit-modal')).toHaveCount(0)
  await page.waitForTimeout(2800) // the announcement arrives while the modal is closed
  expect(probed).toEqual([])      // no probe for the late result
  await page.locator('.submit-btn').click()
  await expect(page.locator('.submit-modal-input')).toHaveValue('') // reopened clean
  await expect(page.locator('.submit-probe-name')).toHaveCount(0)
  await expect(page.locator('.submit-ok-btn')).toBeDisabled()
  expect(errors.filter(e => !/Failed to load resource|favicon/i.test(e))).toEqual([])
})
