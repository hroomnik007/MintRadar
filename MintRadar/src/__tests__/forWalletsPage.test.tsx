// The /for-wallets page is generated from data (utils/walletFields.ts, constants/forWalletsPage.ts). These tests
// compare that data with the REAL wallet API code (backend/src/walletApi.ts): the mapper output, the envelopes,
// the query parser, the error codes and the numbers, and check that the examples use only documented things.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ForWallets from '@/pages/ForWallets'
import {
  WALLET_ENVELOPE_FIELDS, WALLET_MINT_FIELDS, WALLET_QUERY_PARAMS, WALLET_ERRORS, type WalletField,
} from '@/utils/walletFields'
import {
  WALLET_EXAMPLES, WALLET_API_FACTS as F, WALLET_API_BASE, EXAMPLE_MINT_URL, EXAMPLE_POLL_MINUTES,
  DOCS_API_URL, DOCS_OPENAPI_URL,
} from '@/constants/forWalletsPage'
import { METHODOLOGY_PAGE } from '@/constants/methodologyPage'
import {
  toWalletMint, walletListEnvelope, walletSingleEnvelope, parseWalletListQuery, sendCachedBody, buildCachedBody,
  WALLET_LIST_DEFAULT_LIMIT, WALLET_LIST_MAX_LIMIT, WALLET_MINT_FIELDS as beMintFields, WALLET_QUERY_PARAMS as beParams,
  type KnownMintLike, type WalletExtra,
} from '../../backend/src/walletApi'
import { RECOMMEND_DEPRECATION } from '../../backend/src/deprecation'
import { HEALTH_RECORD_READ_CODE, HEALTH_RECORD_READ_TEXT, HEALTH_RECORD_READ_TITLE } from '@/constants/healthAssertionPage'
import { healthIdentifier as beHealthIdentifier } from '../../backend/src/healthAssertions'

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0)

const FULL: KnownMintLike = {
  url: 'https://mint.example.com', name: 'Example Mint', archived: false, degraded: false, online: true,
  version: 'Nutshell/0.21.0', softwareLatest: { major: 0, minor: 21 }, nutsLimits: { '4': {}, '5': {}, '7': {} },
  units: ['sat'], auditCzTotal: 104, auditCzBlamed: 0, auditCzFetchedAt: '2026-10-12T17:40:00.000Z',
  discoveredAt: '2026-01-01T00:00:00.000Z', reliabilityScore: 92, uptimePct24h: 100, uptimePct7d: 99,
  lastCheckedAt: '2026-10-13T11:59:00.000Z', reviewCount: 12, reviewRatedCount: 10, reviewAvgRating: 4.6,
  operatorReviewCount: 1, latencyMs: 120,
  pubkey: '02' + 'ab'.repeat(32), hasOnion: true, lastOnlineAt: '2026-10-13T11:59:00.000Z',
  mintMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 100000 }], meltMethods: [{ method: 'bolt11', unit: 'sat' }],
}
const FULL_EXTRA: WalletExtra = {
  probes24h: 288, downSince: null, keysetsCheckedAt: '2026-10-13T11:00:00.000Z',
  keysets: [{ id: '00aaaaaaaaaaaaaa', unit: 'sat', active: true, inputFeePpk: 100, finalExpiry: null, idVersion: 'v1', idValid: true }],
  scoreBreakdown: {
    uptime: { points: 40, max: 40 }, audit: { points: 25, max: 25 }, nuts: { points: 6, max: 15 }, version: { points: 15, max: 15 },
    contact: { points: 5, max: 5 }, newMintCap: { points: 0, cap: 75 }, sum: 92,
  },
  changes: [{ type: 'motd_changed', field: 'motd', oldValue: 'a', newValue: null, observedAt: '2026-10-13T11:00:00.000Z', firstSeenAt: '2026-10-13T10:55:00.000Z' }],
  auditDirections: { asSource: { total: 64, failed: 13 }, asDest: { total: 62, failed: 6 }, fetchedAt: '2026-10-13T11:30:00.000Z' },
}
const EMPTY: KnownMintLike = {
  ...FULL, name: null, online: null, version: null, softwareLatest: null, nutsLimits: null, units: null,
  auditCzTotal: null, auditCzBlamed: null, auditCzFetchedAt: null, discoveredAt: null, reliabilityScore: null,
  uptimePct24h: null, uptimePct7d: null, lastCheckedAt: null, reviewCount: null, reviewRatedCount: null,
  reviewAvgRating: null, operatorReviewCount: null,
  pubkey: null, hasOnion: null, lastOnlineAt: null, mintMethods: null, meltMethods: null,
}

type Json = Record<string, unknown>
const valueAt = (obj: Json, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o !== null && typeof o === 'object' ? (o as Json)[k] : undefined), obj)

/** "a", "b", "audit", "audit.swaps7d", ... for one mapper result. */
function flatten(m: Json): string[] {
  return Object.entries(m).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? [k, ...Object.keys(v as Json).map(c => `${k}.${c}`)] : [k])
}

describe('mint object: the field table equals the real mapper', () => {
  const full = toWalletMint(FULL, NOW, undefined, FULL_EXTRA) as unknown as Json
  const empty = toWalletMint(EMPTY, NOW) as unknown as Json
  // offline with a neutral audit: the values downSince and auditNeutralReason take only then
  const down = toWalletMint({ ...FULL, online: false, auditCzTotal: 3 }, NOW, undefined, { ...FULL_EXTRA, downSince: '2026-10-13T10:00:00.000Z' }) as unknown as Json

  it('lists exactly the keys the mapper produces (nested keys as parent.child)', () => {
    expect(new Set(WALLET_MINT_FIELDS.map(f => f.name)).size).toBe(WALLET_MINT_FIELDS.length)
    expect([...WALLET_MINT_FIELDS.map(f => f.name)].sort()).toEqual([...flatten(full)].sort())
    // the same keys with every input missing, except the nested ones of an object that is null then
    expect(flatten(empty).sort()).toEqual(flatten(full).filter(k => !/^(audit|authRequired|methods|limits|scoreBreakdown)\./.test(k)).sort())
  })

  it('"Null: yes" is exactly the fields the mapper can return as null', () => {
    for (const f of WALLET_MINT_FIELDS) {
      const canBeNull = [full, empty].some(m => valueAt(m, f.name) === null)
      expect(f.nullable, f.name).toBe(canBeNull)
    }
  })

  it('the documented type matches the real value', () => {
    const check: Record<string, (v: unknown) => boolean> = {
      string: v => typeof v === 'string', integer: v => Number.isInteger(v), number: v => typeof v === 'number',
      boolean: v => typeof v === 'boolean', object: v => typeof v === 'object' && v !== null && !Array.isArray(v),
      'string[]': v => Array.isArray(v) && v.every(x => typeof x === 'string'),
      'object[]': v => Array.isArray(v) && v.every(x => typeof x === 'object' && x !== null),
    }
    const kind = (f: WalletField) =>
      f.type.startsWith('string (ISO') ? 'string' : f.type.startsWith('integer') ? 'integer'
        : f.type.startsWith('"') ? 'string' : f.type
    for (const f of WALLET_MINT_FIELDS) {
      const v = [full, down, empty].map(m => valueAt(m, f.name)).find(x => x !== null && x !== undefined)
      expect(check[kind(f)]?.(v), `${f.name} (${f.type})`).toBe(true)
    }
    expect(WALLET_MINT_FIELDS.find(f => f.name === 'status')!.type).toBe('"online" | "offline" | "degraded" | "archived"')
  })

  it('the backend re-export is the same list', () => {
    expect(beMintFields).toEqual(WALLET_MINT_FIELDS)
    expect(beParams).toEqual(WALLET_QUERY_PARAMS)
  })

  it('every field has a meaning and the page quotes the same cap, gate and thresholds as the score code', () => {
    for (const f of WALLET_MINT_FIELDS) expect(f.meaning.length, f.name).toBeGreaterThan(10)
    const by = (n: string) => WALLET_MINT_FIELDS.find(f => f.name === n)!.meaning
    expect(by('scoreCappedNew')).toContain(`younger than ${METHODOLOGY_PAGE.newMint.capDays} days`)
    expect(by('scoreCappedNew')).toContain(`capped at ${METHODOLOGY_PAGE.newMint.capPoints}`)
    expect(by('eligibleForRecommendation')).toContain(`at least ${METHODOLOGY_PAGE.recommendation.minAgeDays} days ago`)
    expect(by('outdated')).toContain('two or more minor versions')
    expect(by('audit')).toContain(`fewer than ${METHODOLOGY_PAGE.audit.minSwaps} swaps`)
    expect(by('audit')).toContain(`older than ${METHODOLOGY_PAGE.audit.maxAgeHours} hours`)
  })
})

describe('envelope', () => {
  it('the envelope table is the union of the list and the single-mint envelope keys', () => {
    const snap = { data: [FULL], computedAt: NOW }
    const list = walletListEnvelope(snap, parseOk({}) ) as Json
    const one = walletSingleEnvelope(snap, FULL.url) as Json
    expect([...WALLET_ENVELOPE_FIELDS.map(f => f.name)].sort()).toEqual([...new Set([...Object.keys(list), ...Object.keys(one)])].sort())
    expect(typeof list['methodology']).toBe('number')
  })
})

function parseOk(q: Record<string, unknown>) {
  const r = parseWalletListQuery(q)
  if (!r.ok) throw new Error(r.message)
  return r.filter
}

describe('list parameters: the table equals the real parser', () => {
  const INVALID: Record<string, string> = {
    unit: '!!', minScore: '101', includeOffline: 'maybe', includeArchived: 'maybe', includeTest: 'maybe',
    includeUnscored: 'maybe', limit: '0', nuts: 'abc', eligible: 'maybe', method: 'lightning', maxInputFeePpk: '1000001', include: 'foo', changedSince: 'yesterday',
  }
  const VALID: Record<string, string> = {
    unit: 'sat', minScore: '70', includeOffline: 'true', includeArchived: 'true', includeTest: 'true',
    includeUnscored: 'true', limit: '20', nuts: '4,5', eligible: 'true', method: 'bolt12', maxInputFeePpk: '100', include: 'keysets,methods,breakdown,changes', changedSince: '2026-10-20T12:00:00Z',
  }

  it('every documented parameter is read by the parser (an invalid value is rejected, a valid one accepted)', () => {
    expect(WALLET_QUERY_PARAMS.map(p => p.name).sort()).toEqual(Object.keys(INVALID).sort())
    for (const p of WALLET_QUERY_PARAMS) {
      expect(parseWalletListQuery({ [p.name]: INVALID[p.name] }).ok, `${p.name} invalid`).toBe(false)
      expect(parseWalletListQuery({ [p.name]: VALID[p.name] }).ok, `${p.name} valid`).toBe(true)
    }
    expect(parseWalletListQuery({ somethingElse: 'x' }).ok).toBe(true) // unknown parameters are ignored
  })

  it('the documented defaults and the limit range are the parser\'s', () => {
    const f = parseOk({})
    const def = (n: string) => WALLET_QUERY_PARAMS.find(p => p.name === n)!.default
    for (const n of ['includeOffline', 'includeArchived', 'includeTest', 'includeUnscored'] as const) expect(def(n)).toBe(String(f[n]))
    expect(def('limit')).toBe(String(WALLET_LIST_DEFAULT_LIMIT))
    expect(WALLET_QUERY_PARAMS.find(p => p.name === 'limit')!.type).toBe(`integer 1 to ${WALLET_LIST_MAX_LIMIT}`)
    expect(parseWalletListQuery({ limit: String(WALLET_LIST_MAX_LIMIT) }).ok).toBe(true)
    expect(parseWalletListQuery({ limit: String(WALLET_LIST_MAX_LIMIT + 1) }).ok).toBe(false)
  })
})

describe('error codes and numbers', () => {
  it('every documented code is sent with its status by the backend', () => {
    const source = read('../../backend/src/index.ts') + read('../../backend/src/walletApi.ts')
    for (const e of WALLET_ERRORS) {
      expect(source, e.code).toMatch(new RegExp(`sendWalletError\\(res, ${e.status}, '${e.code}'`))
    }
  })

  it('rate limit, cache lifetime and poll advice', () => {
    expect(read('../../backend/src/index.ts')).toContain(`const WALLET_RATE_LIMIT_MAX = ${F.rateLimitPerMinute}`)
    expect(WALLET_ERRORS.find(e => e.code === 'rate_limited')!.when).toContain(String(F.rateLimitPerMinute))
    const headers: Record<string, string> = {}
    const res = { setHeader: (k: string, v: string) => { headers[k] = v }, type: () => res, send: () => res } as never
    sendCachedBody(res, buildCachedBody({ a: 1 }))
    expect(headers['Cache-Control']).toBe(`public, max-age=${F.cacheMaxAgeSeconds}`)
    expect(headers['ETag']).toMatch(/^"[0-9a-f]{32}"$/)
    expect(F.pollMinutes * 60).toBe(F.cacheMaxAgeSeconds)
    expect(F.pollMinutes).toBe(METHODOLOGY_PAGE.cadence.probeMinutes)
    expect(EXAMPLE_POLL_MINUTES).toBeGreaterThanOrEqual(F.pollMinutes)
  })

  it('the deprecation notice period is the one in docs/API.md and the OpenAPI file', () => {
    expect(read('../../docs/API.md')).toContain(`at least **${F.deprecationNoticeDays} days**`)
    expect(read('../../docs/openapi/wallets-v1.yaml')).toContain(`at least ${F.deprecationNoticeDays} days`)
  })

  it('the /mints/recommend deprecation on the page is the one the backend sends, and docs/API.md and the OpenAPI file name it', () => {
    expect(F.recommendDeprecatedOn).toBe(RECOMMEND_DEPRECATION.deprecatedOn)
    expect(F.recommendSunsetOn).toBe(RECOMMEND_DEPRECATION.sunsetOn)
    const noticeDays = (Date.parse(F.recommendSunsetOn) - Date.parse(F.recommendDeprecatedOn)) / 86_400_000
    expect(noticeDays).toBeGreaterThanOrEqual(F.deprecationNoticeDays)
    const replacement = new URL(RECOMMEND_DEPRECATION.successorUrl)
    expect(WALLET_API_BASE + F.recommendReplacementQuery).toBe(replacement.origin + replacement.pathname + replacement.search)
    expect(Array.from(replacement.searchParams.keys()).every(k => WALLET_QUERY_PARAMS.some(p => p.name === k))).toBe(true)
    for (const file of ['../../docs/API.md', '../../docs/openapi/wallets-v1.yaml']) {
      const text = read(file)
      expect(text, file).toContain(F.recommendDeprecatedOn)
      expect(text, file).toContain(F.recommendSunsetOn)
    }
    expect(read('../../docs/API.md')).toContain(RECOMMEND_DEPRECATION.successorUrl)
  })

  it('the NUT-11 and NUT-12 example query is a real list query and is in docs/API.md and the OpenAPI file', () => {
    const q = new URL(WALLET_API_BASE + F.nutzapQuery)
    expect(q.searchParams.get('nuts')).toBe('11,12')
    expect(Array.from(q.searchParams.keys()).every(k => WALLET_QUERY_PARAMS.some(p => p.name === k))).toBe(true)
    expect(read('../../docs/API.md')).toContain('/api/v1/wallets/mints?nuts=11,12')
    expect(read('../../docs/openapi/wallets-v1.yaml')).toContain('nuts=11,12')
  })

  it('the "find the record of a mint from the API" example is the same on the page and in docs/API.md, uses only the url field, and the API gives no naddr or njump field', () => {
    const api = read('../../docs/API.md').replace(/`/g, '')
    expect(api).toContain(HEALTH_RECORD_READ_TITLE)
    for (const t of HEALTH_RECORD_READ_TEXT) expect(api, t).toContain(t)
    expect(read('../../docs/API.md')).toContain(HEALTH_RECORD_READ_CODE.split('\n').map(l => l).join('\n  '))
    // the d tag of the record is the url field: the publisher's identifier of an API url is that url itself
    for (const u of ['https://mint.minibits.cash/Bitcoin', 'https://mint.example.com', 'https://mint.example.com:3338/x']) {
      const apiUrl = toWalletMint({ ...FULL, url: u }, NOW).url
      expect(beHealthIdentifier(apiUrl)).toBe(apiUrl)
    }
    // nothing was added to the API: no field carries the address or the link
    const names = [...WALLET_MINT_FIELDS, ...WALLET_ENVELOPE_FIELDS].map(f => f.name.toLowerCase())
    expect(names.filter(n => /naddr|njump|nak/.test(n))).toEqual([])
  })

  it('the documentation links use the blob URL pattern of the footer API link and point at files that exist', () => {
    const footer = read('../components/layout/AppShell.tsx')
    expect(footer).toContain('https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md')
    expect(DOCS_API_URL).toBe('https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/API.md')
    expect(DOCS_OPENAPI_URL).toBe('https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/openapi/wallets-v1.yaml')
    expect(read('../../docs/openapi/wallets-v1.yaml').length).toBeGreaterThan(100)
  })
})

describe('examples use only documented parameters, paths, headers, fields and hosts', () => {
  const documented = new Set(WALLET_QUERY_PARAMS.map(p => p.name))
  const fieldTop = new Set(WALLET_MINT_FIELDS.map(f => f.name.split('.')[0]))
  const envelope = new Set(WALLET_ENVELOPE_FIELDS.map(f => f.name))

  it('every API URL is the list or one percent-encoded mint, with documented, accepted parameters', () => {
    let urls = 0
    for (const ex of WALLET_EXAMPLES) {
      for (const raw of ex.code.match(/https:\/\/mintradar\.org\/[^'"`\s]*/g) ?? []) {
        urls += 1
        const u = new URL(raw)
        expect(u.origin + u.pathname.slice(0, WALLET_API_BASE.length - u.origin.length)).toBe(WALLET_API_BASE)
        const path = u.pathname.slice('/api/v1'.length)
        if (path === '/wallets/mints/') continue // the prefix of a concatenated URL: encodeURIComponent follows
        if (path === '/wallets/mints') {
          const params = Object.fromEntries(u.searchParams)
          for (const k of Object.keys(params)) expect(documented.has(k), `${ex.id}: ${k}`).toBe(true)
          expect(parseWalletListQuery(params).ok, ex.id).toBe(true)
        } else {
          const m = /^\/wallets\/mints\/(.+)$/.exec(path)
          expect(m, `${ex.id}: ${path}`).not.toBeNull()
          const decoded = decodeURIComponent(m![1]!)
          expect(m![1], ex.id).toBe(encodeURIComponent(decoded))
          expect(decoded).toMatch(/^https:\/\/[^/]+/)
          expect(u.search).toBe('')
        }
      }
    }
    expect(urls).toBeGreaterThanOrEqual(5)
  })

  it('the two quick-start requests are the ones the page promises', () => {
    const code = (id: string) => WALLET_EXAMPLES.find(e => e.id === id)!.code
    for (const id of ['list-curl', 'list-fetch']) {
      expect(code(id)).toContain('unit=sat&minScore=70')
    }
    for (const id of ['one-curl']) {
      expect(code(id)).toContain(`/wallets/mints/${encodeURIComponent(EXAMPLE_MINT_URL)}`)
    }
    expect(code('one-fetch')).toContain(EXAMPLE_MINT_URL)
    expect(code('one-fetch')).toContain('encodeURIComponent(mintUrl)')
  })

  it('request headers are only If-None-Match, response fields read exist, hosts are mintradar.org and the example mint', () => {
    for (const ex of WALLET_EXAMPLES) {
      for (const h of ex.code.match(/'([A-Za-z-]+)':/g) ?? []) expect(h).toBe("'If-None-Match':")
      for (const [, k] of ex.code.matchAll(/(?<![\w.])m\.(\w+)/g)) expect(fieldTop.has(k!), `${ex.id}: m.${k}`).toBe(true)
      for (const [, k] of ex.code.matchAll(/(?<![\w./])mint\.(\w+)/g)) expect(fieldTop.has(k!), `${ex.id}: mint.${k}`).toBe(true)
      for (const [, k] of ex.code.matchAll(/const \{ ([\w, ]+) \} = await res\.json\(\)/g)) {
        for (const name of k!.split(', ')) expect(envelope.has(name), `${ex.id}: ${name}`).toBe(true)
      }
      for (const host of (ex.code.match(/https?:\/\/[^/'"`\s]+/g) ?? []).map(x => new URL(x).host)) {
        expect(['mintradar.org', new URL(EXAMPLE_MINT_URL).host]).toContain(host)
      }
      expect(ex.code).not.toMatch(/api[_-]?key|token|secret|password|Authorization/i)
    }
  })
})

describe('the rendered page', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const renderPage = (ui = <ForWallets />) => render(<MemoryRouter initialEntries={['/for-wallets']}>{ui}</MemoryRouter>).container

  it('has one h1, a logical heading order and tables with one row per documented item', () => {
    const c = renderPage()
    expect(c.querySelectorAll('h1')).toHaveLength(1)
    const levels = Array.from(c.querySelectorAll('h1,h2,h3,h4')).map(h => Number(h.tagName[1]))
    levels.forEach((l, i) => { if (i > 0) expect(l, `heading ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1) })
    const rows = (attr: string) => Array.from(c.querySelectorAll(`[${attr}]`)).map(r => r.getAttribute(attr))
    expect(rows('data-field')).toEqual([...WALLET_ENVELOPE_FIELDS, ...WALLET_MINT_FIELDS].map(f => f.name))
    expect(rows('data-param')).toEqual(WALLET_QUERY_PARAMS.map(p => p.name))
    expect(rows('data-code')).toEqual(WALLET_ERRORS.map(e => e.code))
  })

  it('is static: it calls fetch never, and every external link opens safely', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const c = renderPage()
    expect(fetchSpy).not.toHaveBeenCalled()
    const external = Array.from(c.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'))
    expect(external.length).toBeGreaterThanOrEqual(3)
    for (const a of external) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')?.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    }
    vi.unstubAllGlobals()
  })

  it('links to /methodology, shows the disclaimer and the contact, and makes none of the forbidden claims', () => {
    const c = renderPage()
    expect(c.querySelector('a[href="/methodology"]')).not.toBeNull()
    const text = c.textContent ?? ''
    expect(text).toContain('Operational health signal, not solvency, not a recommendation to deposit funds')
    expect(text).toContain('npub1zatej55x47xzhnw06yarqr5ugz7y5el8vygcckek24e5qmrtx77qnmd6rg')
    expect(text).toMatch(/Signed health assertions on Nostr \(early version\)/) // announced since 2026-10-13 (healthAssertionsSection.test.tsx)
    expect(text).not.toMatch(/(?<![-\w])(first|only) (api|service|tool|platform|source|provider|project|monitor)\b|\bno other\b|\bunique\b/i)
    expect(c.querySelector('a[href^="mailto:"]')).toBeNull()
  })

  it('every code block has a copy button that copies exactly that code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const c = renderPage()
    const buttons = Array.from(c.querySelectorAll<HTMLButtonElement>('.doc-copy-btn'))
    const blocks = Array.from(c.querySelectorAll('.doc-code-pre code')).map(b => b.textContent)
    expect(buttons.length).toBe(WALLET_EXAMPLES.length + 1 + 7) // the examples, the error body and the 7 blocks of the signed assertions section (npub, hex, 2 filters, the record-from-the-API example, install, snippet)
    expect(blocks).toContain(HEALTH_RECORD_READ_CODE)
    expect(blocks).toHaveLength(buttons.length)
    for (const ex of WALLET_EXAMPLES) expect(blocks).toContain(ex.code)
    fireEvent.click(buttons[1]!)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(blocks[1]))
    await waitFor(() => expect(buttons[1]!.textContent).toBe('Copied'))
    expect(screen.getAllByRole('status').some(s => s.textContent === 'Copied to the clipboard')).toBe(true)
  })

  it('shows "Copy failed" when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    const c = renderPage()
    const button = c.querySelector<HTMLButtonElement>('.doc-copy-btn')!
    fireEvent.click(button)
    await waitFor(() => expect(button.textContent).toBe('Copy failed'))
  })
})

describe('page text added with the 2026-10-20 wallet additions', () => {
  it('states the request-privacy rule, lists every addition and names the new exposed headers', () => {
    const { container } = render(<MemoryRouter><ForWallets /></MemoryRouter>)
    const text = container.textContent ?? ''
    expect(container.querySelector('[data-testid="request-privacy"]')?.textContent).toContain('download the whole list and filter locally')
    expect(container.querySelector('[data-testid="request-privacy"]')?.textContent).toContain('tells MintRadar which mint you asked about')
    const additions = container.querySelector('[data-testid="additions"]')?.textContent ?? ''
    expect(additions).toContain(F.walletAdditionsOn)
    for (const name of ['method', 'maxInputFeePpk', 'include', 'total', 'truncated', 'canonicalUrl', 'pubkey', 'firstSeenAt', 'lastOnlineAt', 'downSince',
      'hasOnion', 'authRequired', 'sample', 'auditNeutralReason', 'keysets', 'keysetsCheckedAt', 'methods', 'scoreBreakdown', 'Deprecation', 'Sunset', 'Link']) {
      expect(additions, name).toContain(name)
    }
    expect(text).toContain('what the score used at its last computation')
  })

  it('names scoreStale, says the score of a mint that is not online is the last measured one, and dates the addition', () => {
    const { container } = render(<MemoryRouter><ForWallets /></MemoryRouter>)
    const li = container.querySelector('[data-testid="additions-score-stale"]')?.textContent ?? ''
    expect(li).toContain(F.walletScoreStaleAddedOn)
    for (const word of ['scoreStale', 'status', 'online', 'last measured one', 'default list']) expect(li, word).toContain(word)
    expect(container.textContent).toContain('label the score as the last measured one')
  })
})

