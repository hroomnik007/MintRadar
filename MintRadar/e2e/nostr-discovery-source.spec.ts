import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { installApiMocks, loginAs } from './fixtures/mocks'

// useNostrDiscovery.ts's background client-side NIP-87 scan (kind:38172,
// fires once per login/page-load) must tag its POST to /api/mints/discover
// with `source: 'auto'` so the backend can give it its own, smaller
// rate-limit budget — separate from the user-initiated Bulk submit's
// `source: 'bulk'` (see backend/src/index.ts's DISCOVER_AUTO_RATE_LIMIT_MAX /
// DISCOVER_BULK_RATE_LIMIT_MAX, and dashboard-bulk-submit.spec.ts for the
// Bulk-side coverage).

const DISCOVERED_MINT_URL = 'https://discovered.mint.example'

function buildDiscoveryEvent(): ReturnType<typeof finalizeEvent> {
  const sk = generateSecretKey()
  const template: EventTemplate = {
    kind: 38172,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', DISCOVERED_MINT_URL], ['d', 'discovered-mint']],
    content: '',
  }
  return finalizeEvent(template, sk)
}

const DISCOVERY_EVENT = buildDiscoveryEvent()

// Custom relay stub: answers a kind:38172 REQ with one signed announcement
// event; everything else gets an immediate EOSE (same convention as
// mockRelays() in fixtures/mocks.ts, but this file needs to inject a real
// event for the discovery query specifically).
async function mockDiscoveryRelays(page: Page): Promise<void> {
  await page.routeWebSocket(/^wss:\/\//, ws => {
    ws.onMessage(message => {
      const data = typeof message === 'string' ? message : message.toString()
      let parsed: unknown
      try { parsed = JSON.parse(data) } catch { return }
      if (!Array.isArray(parsed)) return
      const [verb, subId, filter] = parsed as [string, string, Record<string, unknown> | undefined]
      if (verb === 'EVENT') {
        const id = (parsed[1] as { id?: string } | undefined)?.id ?? ''
        ws.send(JSON.stringify(['OK', id, true, '']))
        return
      }
      if (verb !== 'REQ') return
      const kinds = (filter?.['kinds'] as number[] | undefined) ?? []
      if (kinds.includes(38172)) {
        ws.send(JSON.stringify(['EVENT', subId, DISCOVERY_EVENT]))
      }
      ws.send(JSON.stringify(['EOSE', subId]))
    })
  })
}

test('automatic NIP-87 discovery tags its request with source: "auto"', async ({ page }) => {
  await mockDiscoveryRelays(page)
  await installApiMocks(page)
  await loginAs(page)

  const discoverRequest = page.waitForRequest(req =>
    req.url().includes('/api/mints/discover') && req.method() === 'POST'
  )
  await page.route('**/api/mints/discover', route => route.fulfill({ json: { added: 1, total: 1, results: [] } }))

  await page.goto('/')
  await expect(page.locator('.dashboard')).toBeVisible()

  const req = await discoverRequest
  const body = req.postDataJSON() as { urls: string[]; source?: string }
  expect(body.source).toBe('auto')
  expect(body.urls).toContain(DISCOVERED_MINT_URL)
})
