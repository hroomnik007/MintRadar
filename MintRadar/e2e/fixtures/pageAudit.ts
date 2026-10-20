import { expect, type Page } from '@playwright/test'
import { nip19 } from 'nostr-tools'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { installApiMocks, mockRelays, probePayload, MOCK_MINTS, MOCK_KNOWN_MINTS } from './mocks'

// The routes and states the page-level specs (keyboard-and-landmarks, page-hygiene) look at, and the in-page collectors.

export interface AuditRoute {
  id: string
  path: string
  /** A selector that is visible once the route has rendered its content. */
  ready: string
  /** Extra mocks before the navigation. */
  before?: (page: Page) => Promise<void>
  /** Brings the page into the state to look at (a tab, a dialog) after `ready`. */
  after?: (page: Page) => Promise<void>
}

const NPUB_OF_REVIEWER = nip19.npubEncode(getPublicKey(generateSecretKey()))

/** Mint Detail with everything that carries a control: public key, mirror URLs, three contacts, a review, the Reviews tab open. */
const richMint: Pick<AuditRoute, 'before' | 'after'> = {
  before: async page => {
    await page.route('**/api/mint/probe**', route => {
      const p = probePayload(MOCK_MINTS[0]!.url)
      return route.fulfill({
        json: { ...p, info: { ...p.info, urls: [MOCK_MINTS[0]!.url, 'https://alpha-mirror.mint.example'], contact: [{ method: 'email', info: 'ops@alpha.example' }, { method: 'twitter', info: '@alpha_mint' }, { method: 'nostr', info: NPUB_OF_REVIEWER }] } },
      })
    })
    await page.route('**/api/mints/nostr-reviews**', route => route.fulfill({
      json: [{ id: 'ab'.repeat(32), pubkey: getPublicKey(generateSecretKey()), content: 'Works well for small amounts.', rating: 5, createdAt: Math.floor(Date.now() / 1000) - 3600, source: 'nostr' }],
    }))
  },
  after: async page => { await page.locator('.md-tab', { hasText: 'Reviews' }).click(); await expect(page.locator('.review-card').first()).toBeVisible() },
}

export const AUDIT_ROUTES: AuditRoute[] = [
  {
    // Every mint claims an icon, so the cards ask the icon proxy for it (page-hygiene mocks the proxy to answer 204 No Content: monogram fallback, no console message).
    id: 'home', path: '/', ready: '.mint-card',
    before: async page => { await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => ({ ...m, iconUrl: 'https://icon.example/i.png' })) })) },
  },
  { id: 'stats', path: '/stats', ready: '.nhi-gauge-wrap' },
  { id: 'tools', path: '/tools', ready: '.tool-title' },
  { id: 'wallets', path: '/wallets', ready: 'h1' },
  { id: 'learn', path: '/learn', ready: 'h1' },
  { id: 'about', path: '/about', ready: 'h1' },
  { id: 'methodology', path: '/methodology', ready: 'h1' },
  { id: 'for-wallets', path: '/for-wallets', ready: '.doc-code' },
  { id: 'watchlist', path: '/watchlist', ready: '.wl-login-gate' },
  { id: 'mint', path: `/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`, ready: '.md-tabs' },
  {
    // The mint claims an icon, so the Mint Detail header asks the icon proxy (page-hygiene answers 204: monogram, console stays empty).
    id: 'mint-icon', path: `/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`, ready: '.md-tabs',
    before: async page => { await page.route('**/api/mints/known', r => r.fulfill({ json: MOCK_KNOWN_MINTS.map(m => ({ ...m, iconUrl: 'https://icon.example/i.png' })) })) },
  },
  { id: 'mint-rich', path: `/mint/${encodeURIComponent(MOCK_MINTS[0]!.url)}`, ready: '.md-tabs', ...richMint },
  { id: 'not-found', path: '/this-page-does-not-exist', ready: 'h1' },
]

export async function loadRoute(page: Page, route: AuditRoute): Promise<void> {
  await mockRelays(page)
  await installApiMocks(page)
  // Mint Detail asks for the outage history; installApiMocks has no answer for it (the dev proxy would return a 502).
  await page.route('**/api/mints/outages**', r => r.fulfill({ json: { sinceLastOutageMs: null, avgRecoveryMs: null, outageCount: 0, outages: [] } }))
  await route.before?.(page)
  await page.goto(route.path)
  await expect(page.locator(route.ready).first()).toBeVisible()
  await route.after?.(page)
}

export interface StructureReport {
  lang: string
  h1: number
  headingLevels: number[]
  landmarks: { main: number; nav: number; footer: number; banner: number }
  duplicateIds: string[]
  imagesWithoutAlt: string[]
  /** Interactive elements the page shows whose accessible name (aria-labelledby, aria-label, content, alt of an inner image, title, label, placeholder) is empty. */
  unnamed: string[]
}

/** Everything the structural checks need, read in one go. Selectors are for humans (tag, id, classes, a bit of text). */
export function collectStructure(page: Page): Promise<StructureReport> {
  return page.evaluate((): StructureReport => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect(); const cs = getComputedStyle(e)
      return cs.display !== 'none' && cs.visibility !== 'hidden' && (r.width > 0 || r.height > 0 || e.matches('input[type=hidden]') === false && cs.position === 'fixed')
    }
    const hiddenByAncestor = (e: Element) => !!e.closest('[hidden], [aria-hidden="true"], [inert]')
    const sel = (e: Element) => {
      const id = e.id ? `#${e.id}` : ''
      const cls = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
      const text = (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)
      return `${e.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`
    }
    const nameOf = (e: Element): string => {
      const by = e.getAttribute('aria-labelledby')
      if (by) { const t = by.split(/\s+/).map(i => document.getElementById(i)?.textContent ?? '').join(' ').trim(); if (t) return t }
      const al = e.getAttribute('aria-label')?.trim(); if (al) return al
      if (e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement) {
        const labels = e.labels ? Array.from(e.labels).map(l => l.textContent ?? '').join(' ').trim() : ''
        if (labels) return labels
        if (e instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(e.type) && e.value) return e.value
        const ph = e.getAttribute('placeholder')?.trim(); if (ph) return ph
      }
      const text = (e.textContent ?? '').trim(); if (text) return text
      const img = e.querySelector('img[alt], svg[aria-label], [role=img][aria-label]')
      const alt = img?.getAttribute('alt') ?? img?.getAttribute('aria-label'); if (alt?.trim()) return alt.trim()
      return e.getAttribute('title')?.trim() ?? ''
    }
    const seen = new Map<string, number>()
    document.querySelectorAll('[id]').forEach(e => seen.set(e.id, (seen.get(e.id) ?? 0) + 1))
    const interactive = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]'))
      .filter(e => visible(e) && !hiddenByAncestor(e))
    return {
      lang: document.documentElement.lang,
      h1: document.querySelectorAll('h1').length,
      headingLevels: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h => visible(h) && !hiddenByAncestor(h)).map(h => Number(h.tagName[1])),
      landmarks: {
        main: document.querySelectorAll('main, [role=main]').length,
        nav: document.querySelectorAll('nav, [role=navigation]').length,
        footer: document.querySelectorAll('footer, [role=contentinfo]').length,
        banner: document.querySelectorAll('header, [role=banner]').length,
      },
      duplicateIds: Array.from(seen).filter(([, n]) => n > 1).map(([id, n]) => `${id} x${n}`),
      imagesWithoutAlt: Array.from(document.querySelectorAll('img:not([alt])')).map(sel),
      unnamed: interactive.filter(e => nameOf(e) === '').map(sel),
    }
  })
}

/** Heading level jumps (h2 then h4): "from>to" for each. A page may start at any level; going back up is fine. */
export function skippedHeadingLevels(levels: number[]): string[] {
  const out: string[] = []
  for (let i = 1; i < levels.length; i++) if (levels[i]! > levels[i - 1]! + 1) out.push(`h${levels[i - 1]}>h${levels[i]} at heading ${i + 1}`)
  return out
}
