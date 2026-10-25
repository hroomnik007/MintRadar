// docs/API.md and docs/openapi/wallets-v1.yaml are what a wallet developer reads first. They must say what the
// code constants say: WALLET_MINT_FIELDS, WALLET_ENVELOPE_FIELDS, WALLET_QUERY_PARAMS, WALLET_ERRORS, the rate limit
// and METHODOLOGY_CHANGES. A failure names the file and the name that differ.
//
// There is no YAML parser among the dependencies, so the OpenAPI file is read with strict, indentation-aware
// patterns over its known structure (2-space indents: components.schemas.<Name>.properties.<field> at 8 spaces,
// `- name:` items of the list endpoint's parameters at 8 spaces). If the file is restructured, the helpers throw
// "not found" instead of silently passing.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { WALLET_ENVELOPE_FIELDS, WALLET_MINT_FIELDS, WALLET_QUERY_PARAMS, WALLET_ERRORS } from '@/utils/walletFields'
import { WALLET_API_FACTS } from '@/constants/forWalletsPage'
import { METHODOLOGY_CHANGES, METHODOLOGY_VERSION } from '@/utils/methodology'
import { HEALTH_ASSERTION_TAGS } from '@/utils/healthAssertionConstants'
import { HEALTH_FACTS } from '@/constants/healthAssertionPage'
import { computeDegraded } from '../../backend/src/degraded'
import { walletListEnvelope, parseWalletListQuery, type KnownMintLike, type WalletExtra } from '../../backend/src/walletApi'

const root = resolve(__dirname, '../..')
const API_MD = 'docs/API.md'
const OPENAPI = 'docs/openapi/wallets-v1.yaml'
const apiMd = readFileSync(resolve(root, API_MD), 'utf8')
const openapi = readFileSync(resolve(root, OPENAPI), 'utf8')
const openapiLines = openapi.split('\n')
const HEALTH_MD = 'docs/nostr-health-assertions.md'
const healthMd = readFileSync(resolve(root, HEALTH_MD), 'utf8')
const backendIndex = readFileSync(resolve(root, 'backend/src/index.ts'), 'utf8')

// ── helpers ──────────────────────────────────────────────────────────────────

function expectSameNames(what: string, file: string, inFile: string[], inCode: string[]): void {
  const f = new Set(inFile)
  const c = new Set(inCode)
  const onlyFile = [...f].filter(n => !c.has(n)).sort()
  const onlyCode = [...c].filter(n => !f.has(n)).sort()
  expect(
    { [`${what}: only in ${file}`]: onlyFile, [`${what}: only in the code constant`]: onlyCode },
    `${what}: ${file} and the code constant differ`,
  ).toEqual({ [`${what}: only in ${file}`]: [], [`${what}: only in the code constant`]: [] })
  expect(inFile.length, `${what}: duplicate name in ${file}`).toBe(f.size)
}

const indentOf = (line: string): number => line.length - line.trimStart().length

/** The keys at `keyIndent` spaces inside the block that starts at the line `header`, until the block ends. */
function keysOfBlock(lines: string[], headerLineIndex: number, keyIndent: number): string[] {
  const headerIndent = indentOf(lines[headerLineIndex]!)
  const keys: string[] = []
  for (let i = headerLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '') continue
    if (indentOf(line) <= headerIndent) break
    const m = new RegExp(`^ {${keyIndent}}([A-Za-z0-9_]+):`).exec(line)
    if (m) keys.push(m[1]!)
  }
  return keys
}

function lineIndex(lines: string[], exact: string, from = 0): number {
  const i = lines.findIndex((l, idx) => idx >= from && l === exact)
  if (i < 0) throw new Error(`${OPENAPI}: expected a line "${exact}" (the file was restructured; update this test)`)
  return i
}

function schemaProperties(schema: string): string[] {
  const schemas = lineIndex(openapiLines, '  schemas:')
  const at = lineIndex(openapiLines, `    ${schema}:`, schemas)
  const props = lineIndex(openapiLines, '      properties:', at)
  return keysOfBlock(openapiLines, props, 8)
}

/** Rows of the markdown table whose header row starts with `header`; cells trimmed, `\|` kept as `|`. */
function mdTable(md: string, header: string): string[][] {
  const lines = md.split('\n')
  const start = lines.findIndex(l => l.startsWith(header))
  if (start < 0) throw new Error(`${API_MD}: table "${header}" not found`)
  const rows: string[][] = []
  for (let i = start + 2; i < lines.length && lines[i]!.startsWith('|'); i++) {
    rows.push(lines[i]!.replace(/\\\|/g, '\uE000').split('|').slice(1, -1).map(c => c.replace(/\uE000/g, '|').trim()))
  }
  return rows
}

const backticked = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map(m => m[1]!)
const stripTicks = (s: string): string => s.replace(/`/g, '').replace(/\*\*/g, '')

// ── the OpenAPI file ─────────────────────────────────────────────────────────

describe(`${OPENAPI} matches the code constants`, () => {
  it('mint fields (including audit.* and reviews.*) equal WALLET_MINT_FIELDS', () => {
    const names = [
      ...schemaProperties('Mint'),
      ...schemaProperties('Audit').map(n => `audit.${n}`),
      ...schemaProperties('Reviews').map(n => `reviews.${n}`),
      ...schemaProperties('AuthRequired').map(n => `authRequired.${n}`),
      ...schemaProperties('Sample').map(n => `sample.${n}`),
      ...schemaProperties('Methods').map(n => `methods.${n}`),
      ...schemaProperties('Limits').map(n => `limits.${n}`),
      ...schemaProperties('AuditByDirection').map(n => `auditByDirection.${n}`),
      ...schemaProperties('ScoreBreakdown').map(n => `scoreBreakdown.${n}`),
      ...schemaProperties('ChangesPending').map(n => `changesPending.${n}`),
    ]
    expectSameNames('mint fields', OPENAPI, names, WALLET_MINT_FIELDS.map(f => f.name))
  })

  it('every mint field listed as required is a property, and nullable fields are typed with null', () => {
    const lines = openapiLines
    const mint = lineIndex(lines, '    Mint:', lineIndex(lines, '  schemas:'))
    const req = lineIndex(lines, '      required:', mint)
    const required: string[] = []
    for (let i = req + 1; /^ {8}- /.test(lines[i]!); i++) required.push(lines[i]!.replace(/^ {8}- /, '').trim())
    // The heavier fields are only present with include= (or on the single-mint endpoint), so they are not required.
    const optional = ['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample', 'keysets', 'keysetsCheckedAt', 'methods', 'scoreBreakdown', 'changes', 'changesPending', 'contactChecks', 'feeExamples', 'limits', 'auditByDirection']
    expectSameNames('required mint fields', OPENAPI, required, schemaProperties('Mint').filter(n => !optional.includes(n)))
    for (const n of optional) expect(schemaProperties('Mint'), `${OPENAPI}: optional mint field ${n}`).toContain(n)
  })

  it('envelope fields (list and single) equal WALLET_ENVELOPE_FIELDS', () => {
    const names = [...schemaProperties('MintList'), ...schemaProperties('MintResponse')]
    expectSameNames('envelope fields', OPENAPI, [...new Set(names)], WALLET_ENVELOPE_FIELDS.map(f => f.name))
  })

  it('error codes equal WALLET_ERRORS', () => {
    const line = openapiLines.find(l => /^ {14}enum: \[.*invalid_parameter.*\]/.test(l))
    if (!line) throw new Error(`${OPENAPI}: the Error code enum was not found`)
    const codes = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']')).split(',').map(s => s.trim())
    expectSameNames('error codes', OPENAPI, codes, WALLET_ERRORS.map(e => e.code))
  })

  it('query parameters and their defaults equal WALLET_QUERY_PARAMS', () => {
    const list = lineIndex(openapiLines, '  /wallets/mints:')
    const params = lineIndex(openapiLines, '      parameters:', list)
    const found: Array<{ name: string; def: string | null }> = []
    for (let i = params + 1; i < openapiLines.length && indentOf(openapiLines[i]!) > 6; i++) {
      const m = /^ {8}- name: (\S+)$/.exec(openapiLines[i]!)
      if (!m) continue
      let inQuery = false
      let def: string | null = null
      for (let j = i + 1; j < openapiLines.length && !/^ {8}- /.test(openapiLines[j]!) && indentOf(openapiLines[j]!) > 8; j++) {
        if (openapiLines[j]!.trim() === 'in: query') inQuery = true
        const d = /\bdefault: ([^\s,}]+)/.exec(openapiLines[j]!)
        if (d) def = d[1]!
      }
      if (inQuery) found.push({ name: m[1]!, def })
    }
    expectSameNames('query parameters', OPENAPI, found.map(p => p.name), WALLET_QUERY_PARAMS.map(p => p.name))
    for (const p of WALLET_QUERY_PARAMS) {
      const inFile = found.find(f => f.name === p.name)!.def
      // 'any' and 'none' mean: no default value in the schema.
      const expected = p.default === 'any' || p.default === 'none' ? null : p.default
      expect(inFile, `query parameter ${p.name}: default in ${OPENAPI}`).toBe(expected)
    }
  })

  it('states the rate limit number of WALLET_API_FACTS', () => {
    const n = WALLET_API_FACTS.rateLimitPerMinute
    const prose = /\*\*Rate limit\.\*\* (\d+) requests per minute per IP address/.exec(openapi)
    expect(prose?.[1], `${OPENAPI}: "Rate limit." paragraph`).toBe(String(n))
    expect(/Requests allowed per minute and IP \((\d+)\)/.exec(openapi)?.[1], `${OPENAPI}: RateLimitLimit header`).toBe(String(n))
    expect(/Over (\d+) requests per minute for this IP/.exec(openapi)?.[1], `${OPENAPI}: 429 response`).toBe(String(n))
  })
})

// ── API.md ───────────────────────────────────────────────────────────────────

describe(`${API_MD} matches the code constants`, () => {
  it('the mint field table names equal the top-level names of WALLET_MINT_FIELDS', () => {
    const names = mdTable(apiMd, '| Mint field |').flatMap(r => backticked(r[0]!))
    expectSameNames('mint fields', API_MD, names, WALLET_MINT_FIELDS.filter(f => !f.name.includes('.')).map(f => f.name))
  })

  it('the envelope table names equal WALLET_ENVELOPE_FIELDS without the two payload keys', () => {
    const names = mdTable(apiMd, '| Envelope field |').flatMap(r => backticked(r[0]!))
    expectSameNames('envelope fields', API_MD, names, WALLET_ENVELOPE_FIELDS.map(f => f.name).filter(n => n !== 'mints' && n !== 'mint'))
  })

  it('the parameter table (names and defaults) equals WALLET_QUERY_PARAMS', () => {
    const rows = mdTable(apiMd, '| Parameter | Default |')
    expectSameNames('query parameters', API_MD, rows.map(r => stripTicks(r[0]!)), WALLET_QUERY_PARAMS.map(p => p.name))
    for (const p of WALLET_QUERY_PARAMS) {
      const row = rows.find(r => stripTicks(r[0]!) === p.name)!
      const expected = p.default === 'any' || p.default === 'none' ? '—' : p.default
      expect(stripTicks(row[1]!), `query parameter ${p.name}: default in ${API_MD}`).toBe(expected)
    }
  })

  it('the error table (status and code) equals WALLET_ERRORS', () => {
    const rows = mdTable(apiMd, '| Status | `code` |')
    const fromFile = rows.map(r => `${stripTicks(r[0]!)} ${stripTicks(r[1]!)}`)
    expectSameNames('errors', API_MD, fromFile, WALLET_ERRORS.map(e => `${e.status} ${e.code}`))
  })

  it('states the rate limit number of WALLET_API_FACTS, in both tables, the 429 row and the backend constant', () => {
    const n = String(WALLET_API_FACTS.rateLimitPerMinute)
    const stated = [...apiMd.matchAll(/\*\*(\d+) requests per minute per IP address\*\*/g)].map(m => m[1])
    expect(stated.length, `${API_MD}: places that state the wallet rate limit`).toBeGreaterThanOrEqual(2)
    for (const s of stated) expect(s, `${API_MD}: wallet rate limit`).toBe(n)
    const row = mdTable(apiMd, '| Status | `code` |').find(r => stripTicks(r[1]!) === 'rate_limited')!
    expect(row[2], `${API_MD}: 429 row`).toContain(`over ${n} requests per minute`)
    expect(backendIndex, 'backend/src/index.ts').toContain(`const WALLET_RATE_LIMIT_MAX = ${n}`)
  })

  it('the methodology version table equals METHODOLOGY_CHANGES, and the newest number is METHODOLOGY_VERSION', () => {
    const rows = mdTable(apiMd, '| Version | Date | Change |')
    const fromFile = rows.map(r => `${r[0]} ${r[1]}`)
    expectSameNames('methodology versions (version date)', API_MD, fromFile, METHODOLOGY_CHANGES.map(c => `${c.version} ${c.date}`))
    expect(Math.max(...rows.map(r => Number(r[0]))), `${API_MD}: newest methodology version`).toBe(METHODOLOGY_VERSION)
  })
})

// ── include=facts: the fields the list adds, in every document that names them ──

const forWalletsPage = readFileSync(resolve(root, 'src/pages/ForWallets.tsx'), 'utf8')
const oneLine = (text: string): string => text.replace(/\s+/g, ' ')

/** The fields the REAL list answer gains with include=facts: its keys with the include minus its keys without. */
function factsFieldsOfTheList(): string[] {
  const mint: KnownMintLike = {
    url: 'https://mint.example.com', name: 'Example Mint', archived: false, degraded: false, online: true,
    version: 'Nutshell/0.21.0', softwareLatest: { major: 0, minor: 21 }, nutsLimits: { '4': {}, '5': {} }, units: ['sat'],
    auditCzTotal: 104, auditCzBlamed: 0, auditCzFetchedAt: '2026-10-12T17:40:00.000Z', discoveredAt: '2026-01-01T00:00:00.000Z',
    reliabilityScore: 92, uptimePct24h: 100, uptimePct7d: 99, lastCheckedAt: '2026-10-13T11:59:00.000Z',
    reviewCount: 0, reviewRatedCount: 0, reviewAvgRating: null, operatorReviewCount: 0, latencyMs: 120,
    pubkey: '02' + 'ab'.repeat(32), hasOnion: false, lastOnlineAt: '2026-10-13T11:59:00.000Z',
    mintMethods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 100000 }], meltMethods: [{ method: 'bolt11', unit: 'sat' }],
  }
  const extra: WalletExtra = {
    probes24h: 288, downSince: null, keysetsCheckedAt: null, keysets: [], scoreBreakdown: null, changes: [], auditDirections: null,
  }
  const snap = { data: [mint], computedAt: Date.UTC(2026, 9, 13, 12, 0, 0), walletExtra: new Map([[mint.url, extra]]) }
  const keysOf = (q: Record<string, unknown>): string[] => {
    const r = parseWalletListQuery(q)
    if (!r.ok) throw new Error(r.message)
    return Object.keys(((walletListEnvelope(snap, r.filter) as { mints: object[] }).mints[0]) as object)
  }
  const without = new Set(keysOf({}))
  return keysOf({ include: 'facts' }).filter(k => !without.has(k))
}

describe('the fields of include=facts (the real list) are named in /for-wallets, the OpenAPI file and API.md', () => {
  const facts = factsFieldsOfTheList()

  it('the real list gains the expected fields with include=facts (a new heavy field must be added to the documents)', () => {
    expect(facts.length).toBeGreaterThanOrEqual(8)
    expect(facts).toEqual(expect.arrayContaining(['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample', 'contactChecks', 'feeExamples', 'limits', 'auditByDirection']))
  })

  it('API.md: the include row lists exactly these fields behind `facts`', () => {
    const row = mdTable(apiMd, '| Parameter | Default |').find(r => stripTicks(r[0]!) === 'include')!
    const m = /\(`facts` brings ([^;]+);/.exec(row[2]!)
    expect(m, `${API_MD}: the include row names what facts brings`).not.toBeNull()
    expectSameNames('include=facts fields', API_MD, backticked(m![1]!), facts)
  })

  it('OpenAPI: the include parameter lists exactly these fields behind `facts`', () => {
    const m = /\(`facts` brings ([^;]+);/.exec(oneLine(openapi))
    expect(m, `${OPENAPI}: the include parameter names what facts brings`).not.toBeNull()
    expectSameNames('include=facts fields', OPENAPI, backticked(m![1]!), facts)
  })

  it('OpenAPI: the list endpoint description names every one of them as an include-only field', () => {
    const m = /The heavier fields \(([^)]+)\) are only in the objects when `include` asks for them/.exec(oneLine(openapi))
    expect(m, `${OPENAPI}: the list description names the heavier fields`).not.toBeNull()
    const named = new Set(backticked(m![1]!))
    expect(facts.filter(f => !named.has(f)), `${OPENAPI}: facts fields missing from the list description`).toEqual([])
  })

  it('/for-wallets: the include row of the parameter table and the prose list exactly these fields', () => {
    const meaning = WALLET_QUERY_PARAMS.find(p => p.name === 'include')!.meaning
    const t = /facts \(([^)]+)\)/.exec(meaning)
    expect(t, 'WALLET_QUERY_PARAMS include: names what facts brings').not.toBeNull()
    expectSameNames('include=facts fields', 'WALLET_QUERY_PARAMS (the /for-wallets parameter table)', t![1]!.split(/,\s*|\s+and\s+/).filter(Boolean), facts)
    const p = /so are (.*?), as <code>include=facts<\/code>/s.exec(oneLine(forWalletsPage))
    expect(p, 'src/pages/ForWallets.tsx: the sentence naming the include=facts fields').not.toBeNull()
    expectSameNames('include=facts fields', 'src/pages/ForWallets.tsx', [...p![1]!.matchAll(/<code>([^<]+)<\/code>/g)].map(x => x[1]!), facts)
  })

  it('every one of them says "include=facts" in the field table of /for-wallets (WALLET_MINT_FIELDS) and in API.md', () => {
    const rows = mdTable(apiMd, '| Mint field |')
    for (const f of facts) {
      expect(WALLET_MINT_FIELDS.find(x => x.name === f)?.meaning, `WALLET_MINT_FIELDS ${f}`).toContain('include=facts')
      const row = rows.find(r => backticked(r[0]!)[0] === f)
      expect(row?.[2], `${API_MD}: field table row ${f}`).toContain('include=facts')
    }
  })
})

// ── `degraded` and `units`: one rule, said the same way everywhere ──────────────

describe('`degraded` is defined as the code defines it (backend/src/degraded.ts) in every document', () => {
  it('the code: at least 4 probes in 24 hours and none online, or a failed latest probe older than 24 hours', () => {
    const now = Date.UTC(2026, 9, 22, 12)
    const hours = (h: number) => new Date(now - h * 3_600_000).toISOString()
    expect(computeDegraded(4, 0, false, hours(1), now)).toBe(true)
    expect(computeDegraded(3, 0, false, hours(1), now)).toBe(false)
    expect(computeDegraded(4, 1, false, hours(1), now)).toBe(false)
    expect(computeDegraded(0, 0, false, hours(24.5), now)).toBe(true)
    expect(computeDegraded(0, 0, false, hours(23.5), now)).toBe(false)
    expect(computeDegraded(0, 0, null, null, now)).toBe(false)
  })

  const places: Array<[string, string]> = [
    [`${API_MD} status row`, mdTable(apiMd, '| Mint field |').find(r => backticked(r[0]!)[0] === 'status')![2]!],
    [`${OPENAPI} status`, oneLine(openapi.slice(openapi.indexOf('          enum: [online, offline, degraded, archived]'), openapi.indexOf('        score:\n          type: [integer', openapi.indexOf('          enum: [online, offline, degraded, archived]'))))],
    ['WALLET_MINT_FIELDS status (/for-wallets)', WALLET_MINT_FIELDS.find(f => f.name === 'status')!.meaning],
    ['HEALTH_ASSERTION_TAGS mint_status (/for-wallets)', HEALTH_ASSERTION_TAGS.find(t => t.name === 'mint_status')!.meaning],
    [`${HEALTH_MD} mint_status row`, mdTable(healthMd, '| Tag | Value | Meaning |').find(r => backticked(r[0]!)[0] === 'mint_status')![2]!],
  ]
  for (const [where, text] of places) {
    it(`${where} says: latest probe failed, at least 4 probes in the last 24 hours with no success, or that failed probe more than 24 hours old`, () => {
      const t = stripTicks(oneLine(text))
      expect(t, where).toContain('the latest probe failed')
      expect(t, where).toMatch(/at least 4 probes in the last 24 hours (and none of them succeeded|all failed)/)
      expect(t, where).toContain('that failed probe is more than 24 hours old')
      expect(t, where).not.toContain('no successful probe')
    })
  }
})

describe('`units` and the `unit` filter say what the code lists (parseMintMethods: payment methods of NUT-04/05, not keysets)', () => {
  const sentence = 'units and the unit= filter list the units for which the mint declares a payment method (NUT-04/05); units that appear only in keysets (include=keysets) are not included, so a mint with no declared methods has units: null.'
  const plain = (t: string) => stripTicks(oneLine(t))
  it('the field and the filter carry the sentence in API.md, the OpenAPI file and /for-wallets', () => {
    const unitRow = mdTable(apiMd, '| Parameter | Default |').find(r => stripTicks(r[0]!) === 'unit')![2]!
    const unitField = mdTable(apiMd, '| Mint field |').find(r => backticked(r[0]!)[0] === 'units')![2]!
    for (const [where, text] of [
      [`${API_MD} unit parameter`, unitRow], [`${API_MD} units field`, unitField],
      [OPENAPI, openapi],
    ] as const) expect(plain(text), where).toContain(sentence)
    expect(plain(openapi).split(sentence).length - 1, `${OPENAPI}: unit parameter and units property`).toBe(2)
    for (const [where, text] of [
      ['WALLET_QUERY_PARAMS unit', WALLET_QUERY_PARAMS.find(p => p.name === 'unit')!.meaning],
      ['WALLET_MINT_FIELDS units', WALLET_MINT_FIELDS.find(f => f.name === 'units')!.meaning],
    ] as const) expect(plain(text), where).toContain(sentence)
    expect(plain(openapi)).not.toContain("keysets list")
  })
})

describe('`contactChecks.domainResolves` says when it is null and false (backend/src/contactChecks.ts) in every document', () => {
  const sentence = 'domainResolves is null when the DNS check could not be completed at the last check (for example a timeout) or does not apply to the contact; it is checked again on the next contact check, about every 24 hours. If a later check cannot be completed, an earlier true is kept for up to 48 hours after that answer (checkedAt is then the time of that answer); a real false always replaces it. NXDOMAIN and a domain with no mail records (no MX and no A/AAAA records, or a null MX) give false.'
  const plain = (t: string) => stripTicks(oneLine(t))
  it('API.md, the OpenAPI file and the /for-wallets field table carry the sentence', () => {
    const field = mdTable(apiMd, '| Mint field |').find(r => backticked(r[0]!)[0] === 'contactChecks')![2]!
    expect(plain(field), `${API_MD} contactChecks field`).toContain(sentence)
    expect(plain(openapi), OPENAPI).toContain(sentence)
    expect(plain(WALLET_MINT_FIELDS.find(f => f.name === 'contactChecks')!.meaning), 'WALLET_MINT_FIELDS contactChecks').toContain(sentence)
  })
})

// ── nostr-health-assertions.md (the signed health feed) ──────────────────────

describe(`${HEALTH_MD} matches the publisher constants`, () => {
  it('the tag table names equal HEALTH_ASSERTION_TAGS (every tag the builder emits, none invented)', () => {
    const names = mdTable(healthMd, '| Tag | Value | Meaning |').flatMap(r => backticked(r[0]!))
    expectSameNames('health tags', HEALTH_MD, names, HEALTH_ASSERTION_TAGS.map(t => t.name))
  })

  it('states the status-change limits of HEALTH_FACTS: the minutes between events of one mint and the events per hour', () => {
    expect(/at least (\d+) minutes between two events of one mint/.exec(healthMd)?.[1], `${HEALTH_MD}: per-mint gap`)
      .toBe(String(HEALTH_FACTS.stateChangeMinGapMinutes))
    expect(/at most (\d+) such events per hour/.exec(healthMd)?.[1], `${HEALTH_MD}: hourly cap`)
      .toBe(String(HEALTH_FACTS.stateChangeMaxPerHour))
    expect(healthMd, `${HEALTH_MD}: run interval`).toContain(`every ${HEALTH_FACTS.runIntervalMinutes} minutes`)
    expect(healthMd, `${HEALTH_MD}: periodic minimum`).toContain(`once per ${HEALTH_FACTS.minIntervalHours} hours`.replace('once', 'one new event'))
  })

  it('does not claim that other monitors publish this format', () => {
    expect(healthMd).toContain('the format is open')
    expect(healthMd).not.toMatch(/other (monitors|providers) (already )?publish/i)
  })
})
