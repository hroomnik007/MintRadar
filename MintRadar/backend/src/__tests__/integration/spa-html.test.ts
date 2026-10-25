import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// GET <any page path> (spaHtml.ts behind nginx's @spa_html): the built index.html with the page's own head and the
// right status, served from the known-mints snapshot. The pool is mocked at the db.js boundary; the template is the
// repository's index.html.

vi.mock('../../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))
vi.mock('../../versionCatalog.js', () => ({
  getLatestVersionsMap: vi.fn().mockResolvedValue({}),
}))

const DAY = 86_400_000
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString()
const row = (url: string, o: Record<string, unknown> = {}) => ({
  url, name: '21Mint', last_reliability_score: 97, latest_online: true, last_online_at: ago(0.001),
  total: 10, online_count: 10, total_7d: 10, online_count_7d: 10, latest_checked_at: ago(0.001), ...o,
})
const ROWS = [
  row('https://21mint.me'),
  row('https://gone.example', { name: 'Gone Mint', latest_online: false, last_online_at: ago(60), last_reliability_score: 3 }),
]

let app: Express
let query: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.resetModules()
  process.env['SPA_INDEX_HTML'] = resolve(__dirname, '../../../../index.html')
  const db = await import('../../db.js')
  query = db.pool.query as unknown as ReturnType<typeof vi.fn>
  query.mockReset()
  query.mockResolvedValue({ rows: ROWS })
  ;({ app } = await import('../../index.js'))
})

const title = (t: string) => t.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/&amp;/g, '&')

describe('server-side head of the SPA', () => {
  it('/ : 200, html, no-cache, the home head', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(title(res.text)).toBe('MintRadar - Cashu Mints Directory & Reliability Score Monitor')
    expect(res.text).toContain('<link rel="canonical" href="https://mintradar.org/" />')
  })

  it('a tracked mint: 200 with its name; an archived one stays 200', async () => {
    const res = await request(app).get(`/mint/${encodeURIComponent('https://21mint.me')}`)
    expect(res.status).toBe(200)
    expect(title(res.text)).toBe('21Mint - Cashu Mint Reliability Score & Uptime | MintRadar')
    expect(res.text).toContain(`<meta property="og:url" content="https://mintradar.org/mint/${encodeURIComponent('https://21mint.me')}" />`)
    const gone = await request(app).get(`/mint/${encodeURIComponent('https://gone.example')}`)
    expect(gone.status).toBe(200)
    expect(title(gone.text)).toBe('Gone Mint - Cashu Mint Reliability Score & Uptime | MintRadar')
  })

  it('unknown path, untracked mint, bad naddr: 404 with the SPA page, noindex', async () => {
    for (const path of ['/no-such-page', `/mint/${encodeURIComponent('https://unknown.example')}`, '/mint/nostr/naddr1bad', '/learn/99']) {
      const res = await request(app).get(path)
      expect(res.status, path).toBe(404)
      expect(res.text).toContain('<div id="root"></div>')
      expect(res.text).toContain('<meta name="robots" content="noindex, follow" />')
      expect(res.text).not.toContain('rel="canonical"')
    }
  })

  it('HEAD answers the same status', async () => {
    expect((await request(app).head('/no-such-page')).status).toBe(404)
    expect((await request(app).head('/stats')).status).toBe(200)
  })

  it('503 (nginx then serves the plain index.html) when the template is missing', async () => {
    process.env['SPA_INDEX_HTML'] = '/nonexistent/index.html'
    const res = await request(app).get('/stats')
    expect(res.status).toBe(503)
  })

  it('/api/* keeps its JSON 404', async () => {
    const res = await request(app).get('/api/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found' })
  })
})
