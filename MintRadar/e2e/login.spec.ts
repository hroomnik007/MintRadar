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
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await page.waitForSelector('.nostr-modal')
  return ws
}

const remoteCard = (page: Page) => page.locator('.nostr-method-card', { hasText: 'Remote signer' })

test('method cards carry icon badges, nsec reachable in one click, its warning shown once selected', async ({ page }) => {
  await setup(page)
  // Extension, Remote signer, then nsec — all three are top-level cards, no
  // disclosure toggle. nsec is visually de-emphasized (muted icon badge) but
  // reachable in one click.
  expect(await page.locator('.nostr-method-title').allTextContents())
    .toEqual(['Nostr extension', 'Remote signer', 'Nostr key (nsec)'])
  await expect(page.locator('.nostr-method-icon svg')).toHaveCount(3)
  await expect(page.locator('.nostr-method-card', { hasText: 'Nostr key (nsec)' }).locator('.nostr-method-desc'))
    .toHaveText('Paste a private key — held in memory for this session only')
  // The single nsec security warning appears only once the nsec card is picked.
  await expect(page.locator('.nostr-advanced-warn')).toHaveCount(0)
  await page.locator('.nostr-method-card', { hasText: 'Nostr key (nsec)' }).click()
  await expect(page.locator('.nostr-advanced-warn')).toBeVisible()
  await expect(page.locator('.nostr-nsec-input')).toBeVisible()
})

test('remote-signer: QR appears automatically on selection (no extra click)', async ({ page }) => {
  await setup(page)
  await expect(page.locator('.nostr-qr-wrap')).toHaveCount(0)
  await remoteCard(page).click()
  // no "Show pairing QR" button — the QR is just there
  await page.waitForSelector('.nostr-qr-wrap svg')
  await expect(page.locator('button', { hasText: /Show pairing QR/i })).toHaveCount(0)

  const fills = await page.$$eval('.nostr-qr-wrap svg path', ps => ps.map(p => p.getAttribute('fill')))
  expect(fills).toEqual(expect.arrayContaining(['#132019', '#f2f7f4']))
  await expect(page.locator('.nostr-qr-caption')).toContainText(/signer app/i)
  // F2 (2026-11-22): relay state + countdown to the 2-minute timeout.
  await expect(page.getByTestId('pairing-status')).toHaveText(/^Connected to relay · waiting for approval \((2:00|1:5\d)\)$/)
  await expect(page.locator('.nostr-remote-divider')).toContainText(/paste the connection link/i)

  // Copy connection link puts the nostrconnect:// pairing URI on the clipboard
  // with brief "Copied" feedback.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.locator('.nostr-qr-copy').click()
  await expect(page.locator('.nostr-qr-copy')).toHaveText(/copied/i)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip.startsWith('nostrconnect://')).toBe(true)
  expect(clip).toMatch(/[?&]relay=/)
  expect(clip).toMatch(/[?&]secret=/)
})

test('remote-signer: bunker:// paste stays available alongside the QR', async ({ page }) => {
  await setup(page)
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  const connect = page.getByRole('button', { name: 'Connect', exact: true })
  await expect(connect).toBeDisabled()
  await expect(connect.locator('svg')).toHaveCount(1)
  expect(await connect.textContent()).not.toContain('⚡')
  await page.locator('.nostr-nsec-input').fill('bunker://abc?relay=wss://x')
  await expect(connect).toBeEnabled() // QR present AND paste usable
})

test('switching away from Remote signer closes every pairing socket', async ({ page }) => {
  const ws = await setup(page)
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  await expect.poll(() => ws.opened).toBeGreaterThan(0)
  const openedWhilePairing = ws.opened

  // Collapse-to-selected: return to the picker before choosing another method.
  await page.getByRole('button', { name: /Back/i }).click()
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
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
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

test('remote-signer: no "Open in signer app" link on a desktop browser', async ({ page }) => {
  await setup(page)
  await remoteCard(page).click()
  await page.waitForSelector('.nostr-qr-wrap svg')
  await expect(page.locator('.nostr-open-signer')).toHaveCount(0)
})

test.describe('on a phone', () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  })

  test('remote-signer: "Open in signer app" is a plain link to the same pairing URI as the copy button', async ({ page }) => {
    await setup(page)
    await page.locator('.nostr-method-card', { hasText: 'Remote signer' }).click()
    await page.waitForSelector('a.nostr-open-signer')
    const link = page.locator('a.nostr-open-signer')
    await expect(link).toHaveCount(1)
    await expect(link).toHaveText('Open in signer app')
    const href = await link.getAttribute('href')
    expect(href?.startsWith('nostrconnect://')).toBe(true)
    expect(href).toMatch(/[?&]relay=/)
    expect(href).toMatch(/[?&]secret=/)
    expect(await link.getAttribute('target')).toBeNull() // same tab: the pairing page must stay alive
    // Same URI as the copy button (the pairing is one and the same).
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.locator('.nostr-qr-copy').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(href)
  })

  test('a fresh pairing replaces the link (New QR changes the href)', async ({ page }) => {
    await setup(page)
    await page.locator('.nostr-method-card', { hasText: 'Remote signer' }).click()
    await page.waitForSelector('a.nostr-open-signer')
    const first = await page.locator('a.nostr-open-signer').getAttribute('href')
    await page.locator('.nostr-qr-refresh').click()
    await expect.poll(() => page.locator('a.nostr-open-signer').getAttribute('href')).not.toBe(first)
  })
  // M7 (2026-11-22): a phone cannot scan its own screen, so "Open in signer app" leads and the QR is folded.
  test('remote-signer on a phone: "Open in signer app" first, QR folded under "Show QR for another device"', async ({ page }) => {
    await setup(page)
    await page.locator('.nostr-method-card', { hasText: 'Remote signer' }).click()
    const link = page.locator('a.nostr-open-signer')
    await expect(link).toBeVisible()
    await expect(page.locator('.nostr-qr-wrap')).toHaveCount(0)
    // the link is the first control of the view, above the copy button
    const linkBox = await link.boundingBox()
    const copyBox = await page.locator('.nostr-qr-copy').boundingBox()
    expect(linkBox!.y).toBeLessThan(copyBox!.y)
    const toggle = page.getByRole('button', { name: 'Show QR for another device' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(page.locator('.nostr-qr-wrap svg')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hide QR' })).toHaveAttribute('aria-expanded', 'true')
  })

  // F1 (2026-11-22): without an extension a phone gets the signer app path, not an install link.
  test('Nostr extension on a phone without one: offers the signer app and switches to Remote signer', async ({ page }) => {
    await setup(page)
    await page.locator('.nostr-method-card', { hasText: 'Nostr extension' }).click()
    await expect(page.locator('.nostr-warn')).toContainText('No Nostr extension detected')
    await expect(page.locator('.nostr-warn a', { hasText: 'Install Alby' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Use Amber instead' }).click()
    await expect(page.locator('a.nostr-open-signer')).toBeVisible()
  })
})
