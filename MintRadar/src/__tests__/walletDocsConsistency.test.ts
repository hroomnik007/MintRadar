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
    ]
    expectSameNames('mint fields', OPENAPI, names, WALLET_MINT_FIELDS.map(f => f.name))
  })

  it('every mint field listed as required is a property, and nullable fields are typed with null', () => {
    const lines = openapiLines
    const mint = lineIndex(lines, '    Mint:', lineIndex(lines, '  schemas:'))
    const req = lineIndex(lines, '      required:', mint)
    const required: string[] = []
    for (let i = req + 1; /^ {8}- /.test(lines[i]!); i++) required.push(lines[i]!.replace(/^ {8}- /, '').trim())
    // The twelve heavier fields are only present with include= (or on the single-mint endpoint), so they are not required.
    const optional = ['pubkey', 'firstSeenAt', 'lastOnlineAt', 'sample', 'keysets', 'keysetsCheckedAt', 'methods', 'scoreBreakdown', 'changes', 'contactChecks', 'feeExamples', 'limits', 'auditByDirection']
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
