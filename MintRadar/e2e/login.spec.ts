import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { installApiMocks } from './fixtures/mocks'

// Like fixtures/mockRelays but counts websocket opens/closes so we can assert
// that aborting a pairing actually tears the sockets down.
async function setup(page: Page) {
  const ws = { opened: 0, closed: 0 }
  await installApiMocks(page)
  await page.routeWebSocket(/^wss:\/\//, socket => {
    ws.opened++
    socket.onMessage(message => {
      const data = typeof message === 'string' ? message : message.toString()
      let parsed: unknown
      try { parsed = JSON.parse(data) } catch { return }
      if (!Array.isArray(parsed)) return
      const [verb, arg] = parsed as [string, unknown]
      if (verb === 'REQ') socket.send(JSON.stringify(['EOSE', arg]))
      else if (verb === 'EVENT') socket.send(JSON.stringify(['OK', (arg as { id?: string })?.id ?? '', true, '']))
    })
    socket.onClose(() => { ws.closed++ })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await page.waitForSelector('.nostr-modal')
  return ws
}

const remoteCard = (page: Page) => page.locator('.nostr-method-card', { hasText: 'Remote signer' })

test('method cards carry icon badges', async ({ page }) => {
  await setup(page)
  expect(await page.locator('.nostr-method-title').allTextContents())
    .toEqual(['Nostr extension', 'Nostr key (nsec)', 'Remote signer'])
  await expect(page.locator('.nostr-method-icon svg')).toHaveCount(3)
})

test('remote-signer: QR appears automatically on selection (no extra click)', async ({ page }) => {
  await setup(page)
  await expect(page.locator('.nostr-qr-wrap')).toHaveCount(0)
  await remoteCard(page).click()
  // no "Show pairing QR" button — the QR is just there
  await page.waitForSelector('.nostr-qr-wrap svg')
  await expect(page.locator('button', { hasText: /Show pairing QR/i })).toHaveCount(0)

  const fills = await page.$$eval('.nostr-qr-wrap svg path', ps => ps.map(p => p.getAttribute('fill')))
  expect(fills).toEqual(expect.arrayContaining(['#17251f', '#f2f7f4']))
  await expect(page.locator('.nostr-qr-caption')).toContainText(/signer app/i)
  await expect(page.locator('.nostr-warn')).toContainText(/remote signer to connect/i)
  await expect(page.locator('.nostr-remote-divider')).toContainText(/paste a connection string/i)
})

test('remote-signer: bunker:// paste stays available alongside the QR', async ({ page }) => {
  await setup(page)
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  const connect = page.getByRole('button', { name: /Connect/i })
  await expect(connect).toBeDisabled()
  await page.locator('.nostr-nsec-input').fill('bunker://abc?relay=wss://x')
  await expect(connect).toBeEnabled() // QR present AND paste usable
})

test('switching away from Remote signer closes every pairing socket', async ({ page }) => {
  const ws = await setup(page)
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  await expect.poll(() => ws.opened).toBeGreaterThan(0)
  const openedWhilePairing = ws.opened

  await page.locator('.nostr-method-card', { hasText: 'Nostr extension' }).click()
  await expect(page.locator('.nostr-qr-wrap')).toHaveCount(0)
  await expect.poll(() => ws.closed, { timeout: 5000 }).toBe(openedWhilePairing)
})

test('closing the modal closes every pairing socket', async ({ page }) => {
  const ws = await setup(page)
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  await expect.poll(() => ws.opened).toBeGreaterThan(0)
  const opened = ws.opened
  await page.keyboard.press('Escape')
  await expect(page.locator('.nostr-modal')).toHaveCount(0)
  await expect.poll(() => ws.closed, { timeout: 5000 }).toBe(opened)

  // reopen: fresh, no dangling QR
  await page.getByRole('button', { name: /Login via Nostr/i }).click()
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
})

test('Refresh replaces the pairing (old sockets closed, new opened)', async ({ page }) => {
  const ws = await setup(page)
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  await expect.poll(() => ws.opened).toBeGreaterThan(0)
  const firstRound = ws.opened

  await page.locator('.nostr-qr-refresh').click()
  await expect.poll(() => ws.closed, { timeout: 5000 }).toBeGreaterThanOrEqual(firstRound)
  await expect.poll(() => ws.opened).toBeGreaterThan(firstRound)
})
