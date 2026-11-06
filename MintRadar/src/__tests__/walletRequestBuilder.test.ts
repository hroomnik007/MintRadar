// The data layer of the /for-wallets request builder (src/utils/walletRequestBuilder.ts) against the REAL wallet API:
// parameter names and order against WALLET_QUERY_PARAMS, bounds/enums/defaults against docs/openapi/wallets-v1.yaml,
// and both directions against parseWalletListQuery (what the builder emits, the backend accepts; what the builder
// rejects, the backend rejects).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { WALLET_QUERY_PARAMS } from '@/utils/walletFields'
import { WALLET_API_BASE, WALLET_EXAMPLES } from '@/constants/forWalletsPage'
import {
  WALLET_REQUEST_PARAMS, buildWalletRequest, walletCurlSnippet, walletFetchSnippet, type WalletRequestValues,
} from '@/utils/walletRequestBuilder'
import { parseWalletListQuery } from '../../backend/src/walletApi'

const openapiLines = readFileSync(resolve(__dirname, '../..', 'docs/openapi/wallets-v1.yaml'), 'utf8').split('\n')

/** The raw `schema:` line of each query parameter of GET /wallets/mints (the file has no YAML parser; see walletDocsConsistency.test.ts). */
function openapiSchemas(): Map<string, string> {
  const list = openapiLines.indexOf('  /wallets/mints:')
  const params = openapiLines.indexOf('      parameters:', list)
  if (list < 0 || params < 0) throw new Error('wallets-v1.yaml: GET /wallets/mints parameters not found')
  const out = new Map<string, string>()
  let name = ''
  for (let i = params + 1; i < openapiLines.length && /^ {7,}|^$/.test(openapiLines[i]!); i++) {
    const line = openapiLines[i]!
    const n = /^ {8}- name: (\S+)$/.exec(line)
    if (n) name = n[1]!
    const s = /^ {10}schema: (.*)$/.exec(line)
    if (s && name) out.set(name, s[1]!)
  }
  return out
}

const queryOf = (url: string): Record<string, string> => Object.fromEntries(new URL(url).searchParams)

describe('parameter description', () => {
  it('has the names and the order of WALLET_QUERY_PARAMS', () => {
    expect(WALLET_REQUEST_PARAMS.map(p => p.name)).toEqual(WALLET_QUERY_PARAMS.map(p => p.name))
    expect(WALLET_REQUEST_PARAMS).toHaveLength(13)
  })

  it('enum values, bounds and defaults equal wallets-v1.yaml', () => {
    const schemas = openapiSchemas()
    for (const p of WALLET_REQUEST_PARAMS) {
      const s = schemas.get(p.name)
      expect(s, `${p.name} has a schema line in wallets-v1.yaml`).toBeDefined()
      const num = (key: string): number | undefined => {
        const m = new RegExp(`\\b${key}: (\\d+)`).exec(s!)
        return m ? Number(m[1]) : undefined
      }
      expect(p.min, `${p.name} minimum`).toBe(num('minimum'))
      expect(p.max, `${p.name} maximum`).toBe(num('maximum'))
      const def = /\bdefault: (\w+)/.exec(s!)?.[1]
      expect(p.default === null ? undefined : String(p.default), `${p.name} default`).toBe(def)
      if (p.kind === 'enum') {
        const e = /enum: \[([^\]]*)\]/.exec(s!)
        expect(e, `${p.name} enum`).not.toBeNull()
        expect(p.values).toEqual(e![1]!.split(',').map(v => v.trim()))
      }
      if (p.kind === 'enum list') {
        const e = /pattern: '\^\(([^)]*)\)\(/.exec(s!)
        expect(e, `${p.name} pattern`).not.toBeNull()
        expect(p.values).toEqual(e![1]!.split('|'))
      }
      if (p.kind === 'text') expect(s).toContain(`{1,${p.maxLength}}`)
      if (p.kind === 'number list') {
        expect(s).toContain(`{1,${p.maxDigits}}`)
        expect(s).toContain(`{0,${(p.maxItems as number) - 1}}`)
      }
      if (p.kind === 'flag') expect(s).toContain('type: boolean')
    }
  })
})

describe('URL composition', () => {
  it('has no question mark when nothing is set', () => {
    for (const v of [{}, { unit: '', limit: undefined, nuts: [], includeTest: false }] as WalletRequestValues[]) {
      expect(buildWalletRequest(v)).toEqual({ url: `${WALLET_API_BASE}/wallets/mints`, errors: [] })
    }
  })

  it('writes only the set parameters, in the order of the list, flags as name=true', () => {
    const r = buildWalletRequest({ limit: '5', includeTest: true, unit: 'sat', includeOffline: 'true' })
    expect(r.errors).toEqual([])
    expect(r.url).toBe(`${WALLET_API_BASE}/wallets/mints?unit=sat&includeOffline=true&includeTest=true&limit=5`)
  })

  it('sorts and de-duplicates nuts, orders include, keeps commas and colons, encodes +', () => {
    const r = buildWalletRequest({
      nuts: '12, 4,11,4', include: ['changes', 'facts', 'methods', 'facts'], changedSince: '2026-10-20T12:00:00+02:00',
    })
    expect(r.errors).toEqual([])
    expect(r.url).toBe(`${WALLET_API_BASE}/wallets/mints?nuts=4,11,12&include=facts,methods,changes&changedSince=2026-10-20T12:00:00%2B02:00`)
  })

  it('leaves an invalid field out of the URL and keeps the valid ones', () => {
    const r = buildWalletRequest({ unit: 'sat', minScore: '101', limit: '10' })
    expect(r.url).toBe(`${WALLET_API_BASE}/wallets/mints?unit=sat&limit=10`)
    expect(r.errors.map(e => e.field)).toEqual(['minScore'])
    expect(r.errors[0]!.message).toMatch(/0 to 100/)
  })
})

// [values the user set, what the backend parser must return for them]
const VALID: Array<[string, WalletRequestValues, Record<string, unknown>]> = [
  ['unit lower bound (1 char)', { unit: 'a' }, { unit: 'a' }],
  ['unit upper bound (16 chars, mixed case)', { unit: 'Abc_def-GHI01234' }, { unit: 'abc_def-ghi01234' }],
  ['unit typical', { unit: 'sat' }, { unit: 'sat' }],
  ['minScore 0', { minScore: '0' }, { minScore: 0 }],
  ['minScore 100', { minScore: '100' }, { minScore: 100 }],
  ['minScore typical', { minScore: '70' }, { minScore: 70 }],
  ['includeOffline', { includeOffline: true }, { includeOffline: true }],
  ['includeArchived', { includeArchived: true }, { includeArchived: true }],
  ['includeTest', { includeTest: 'true' }, { includeTest: true }],
  ['includeUnscored', { includeUnscored: true }, { includeUnscored: true }],
  ['nuts one number', { nuts: '1' }, { requiredNuts: ['1'] }],
  ['nuts 3 digits', { nuts: '999' }, { requiredNuts: ['999'] }],
  ['nuts typical', { nuts: '5,4' }, { requiredNuts: ['4', '5'] }],
  ['nuts 32 numbers', { nuts: Array.from({ length: 32 }, (_, i) => String(i + 1)).join(',') }, { requiredNuts: Array.from({ length: 32 }, (_, i) => String(i + 1)) }],
  ['eligible true', { eligible: true }, { eligible: true }],
  ['eligible false', { eligible: 'false' }, { eligible: false }],
  ['method bolt11', { method: 'bolt11' }, { method: 'bolt11' }],
  ['method bolt12', { method: 'bolt12' }, { method: 'bolt12' }],
  ['method onchain', { method: 'onchain' }, { method: 'onchain' }],
  ['maxInputFeePpk 0', { maxInputFeePpk: '0' }, { maxInputFeePpk: 0 }],
  ['maxInputFeePpk 1000000', { maxInputFeePpk: '1000000' }, { maxInputFeePpk: 1000000 }],
  ['maxInputFeePpk typical', { maxInputFeePpk: '100' }, { maxInputFeePpk: 100 }],
  ['include one', { include: 'keysets' }, { include: ['keysets'] }],
  ['include all (out of order)', { include: ['changes', 'breakdown', 'methods', 'keysets', 'facts'] }, { include: ['facts', 'keysets', 'methods', 'breakdown', 'changes'] }],
  ['changedSince bare date', { changedSince: '2026-10-20' }, { changedSince: Date.parse('2026-10-20T00:00:00Z') }],
  ['changedSince Z', { changedSince: '2026-10-20T12:00:00Z' }, { changedSince: Date.parse('2026-10-20T12:00:00Z') }],
  ['changedSince offset with +', { changedSince: '2026-10-20T12:00:00+02:00' }, { changedSince: Date.parse('2026-10-20T12:00:00+02:00') }],
  ['changedSince offset with -, milliseconds', { changedSince: '2026-10-20T12:00:00.123-05:30' }, { changedSince: Date.parse('2026-10-20T12:00:00.123-05:30') }],
  ['changedSince UNIX 9 digits', { changedSince: '123456789' }, { changedSince: 123456789000 }],
  ['changedSince UNIX 11 digits', { changedSince: '99999999999' }, { changedSince: 99999999999000 }],
  ['limit 1', { limit: '1' }, { limit: 1 }],
  ['limit 200', { limit: '200' }, { limit: 200 }],
  ['limit typical', { limit: '50' }, { limit: 50 }],
  ['combination 1', { unit: 'sat', minScore: '70', nuts: '11,12', method: 'bolt11', limit: '20' }, { unit: 'sat', minScore: 70, requiredNuts: ['11', '12'], method: 'bolt11', limit: 20 }],
  ['combination 2', { includeOffline: true, includeArchived: true, includeTest: true, includeUnscored: true, eligible: 'false', include: 'facts,changes' }, { includeOffline: true, includeArchived: true, includeTest: true, includeUnscored: true, eligible: false, include: ['facts', 'changes'] }],
  ['combination 3 (every parameter)', {
    unit: 'usd', minScore: '1', includeOffline: true, includeArchived: true, includeTest: true, includeUnscored: true, nuts: '4', eligible: true,
    method: 'onchain', maxInputFeePpk: '5', include: 'breakdown', changedSince: '2026-01-01T00:00Z', limit: '200',
  }, {
    unit: 'usd', minScore: 1, includeOffline: true, includeArchived: true, includeTest: true, includeUnscored: true, requiredNuts: ['4'], eligible: true,
    method: 'onchain', maxInputFeePpk: 5, include: ['breakdown'], changedSince: Date.parse('2026-01-01T00:00Z'), limit: 200,
  }],
]

describe('valid inputs are accepted by the real backend parser', () => {
  it.each(VALID)('%s', (_name, values, expected) => {
    const { url, errors } = buildWalletRequest(values)
    expect(errors).toEqual([])
    const parsed = parseWalletListQuery(queryOf(url))
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true)
    if (parsed.ok) expect(parsed.filter).toMatchObject(expected)
  })
})

// [field, the value as the user typed it]; the real backend parser must reject the same value on its own.
const INVALID: Array<[string, string, string | string[]]> = [
  ['unit', 'too long', 'a'.repeat(17)],
  ['unit', 'space inside', 'sa t'],
  ['unit', 'quote', "sat'"],
  ['unit', 'dollar', 'sat$'],
  ['unit', 'unicode', 'sät'],
  ['minScore', 'above 100', '101'],
  ['minScore', 'negative', '-1'],
  ['minScore', 'decimal', '70.5'],
  ['minScore', 'text', 'abc'],
  ['minScore', 'exponent', '1e2'],
  ['includeOffline', 'false is not "true or unset"', 'yes'],
  ['eligible', 'not a boolean', 'maybe'],
  ['eligible', 'upper case', 'TRUE'],
  ['nuts', 'too many (33)', Array.from({ length: 33 }, (_, i) => String(i + 1)).join(',')],
  ['nuts', 'too many with duplicates', Array.from({ length: 33 }, () => '4').join(',')],
  ['nuts', '4 digits', '1000'],
  ['nuts', 'text item', '4,x'],
  ['nuts', 'empty item', '4,,5'],
  ['nuts', 'negative', '-4'],
  ['method', 'unknown', 'bolt99'],
  ['method', 'on-chain', 'on-chain'],
  ['maxInputFeePpk', 'above max', '1000001'],
  ['maxInputFeePpk', 'negative', '-1'],
  ['maxInputFeePpk', 'decimal', '1.5'],
  ['include', 'unknown value', 'facts,everything'],
  ['include', 'empty item', 'facts,,keysets'],
  ['changedSince', 'wrong format', '20.10.2026'],
  ['changedSince', 'time without zone', '2026-10-20T12:00:00'],
  ['changedSince', 'impossible month', '2026-13-01'],
  ['changedSince', '8-digit number', '12345678'],
  ['changedSince', '12-digit number', '123456789012'],
  ['changedSince', 'text', 'yesterday'],
  ['changedSince', 'longer than 40 characters', '2026-10-20T12:00:00.123+02:00' + 'x'.repeat(12)],
  ['limit', 'zero', '0'],
  ['limit', 'above 200', '201'],
  ['limit', 'decimal', '2.5'],
  ['limit', 'text', 'many'],
]

describe('invalid inputs are rejected by the builder and by the real backend parser', () => {
  it.each(INVALID)('%s: %s', (field, _why, value) => {
    const { url, errors } = buildWalletRequest({ [field]: value })
    expect(errors.map(e => e.field)).toEqual([field])
    expect(errors[0]!.message.length).toBeGreaterThan(0)
    expect(url).toBe(`${WALLET_API_BASE}/wallets/mints`)
    // The backend must reject the very same raw value. (A flag value of 'false' is valid for the backend but outside the
    // builder's "true or unset", so it is not in this table.)
    const parsed = parseWalletListQuery({ [field]: value })
    expect(parsed.ok, `backend accepted ${field}=${String(value)}`).toBe(false)
  })

  it('reports one error per invalid field and keeps going', () => {
    const r = buildWalletRequest({ unit: '!', minScore: '999', limit: '3' })
    expect(r.errors.map(e => e.field)).toEqual(['unit', 'minScore'])
    expect(r.url).toBe(`${WALLET_API_BASE}/wallets/mints?limit=3`)
  })

  it('bounds the input: huge values are errors and are never put into a URL', () => {
    const huge = 'x'.repeat(100_000)
    const r = buildWalletRequest({ unit: huge, minScore: huge, nuts: huge, include: huge, changedSince: huge, method: huge, limit: huge })
    expect(r.errors).toHaveLength(7)
    expect(r.url).toBe(`${WALLET_API_BASE}/wallets/mints`)
  })

  it('does not take long to reject adversarial input (no catastrophic backtracking)', () => {
    const t = Date.now()
    buildWalletRequest({ changedSince: '2026-10-20T' + '1'.repeat(28) + '!', nuts: '1,'.repeat(100), unit: '-'.repeat(15) + '!' })
    buildWalletRequest({ nuts: ('1,'.repeat(127)) + '!', include: 'facts,'.repeat(40) })
    expect(Date.now() - t).toBeLessThan(500)
  })
})

describe('snippets', () => {
  it('unit=sat and minScore=70 give the list-curl and list-fetch examples of the page, character for character', () => {
    const { url, errors } = buildWalletRequest({ unit: 'sat', minScore: '70' })
    expect(errors).toEqual([])
    expect(walletCurlSnippet(url)).toBe(WALLET_EXAMPLES.find(e => e.id === 'list-curl')!.code)
    expect(walletFetchSnippet(url)).toBe(WALLET_EXAMPLES.find(e => e.id === 'list-fetch')!.code)
  })

  const every: WalletRequestValues = {
    unit: 'Usd_-', minScore: '5', includeOffline: true, includeArchived: true, includeTest: true, includeUnscored: true, nuts: '4,5',
    eligible: false, method: 'bolt12', maxInputFeePpk: '10', include: 'facts,changes', changedSince: '2026-10-20T12:00:00+02:00', limit: '7',
  }

  it('a snippet contains the URL exactly once, no header, and nothing that needs escaping', () => {
    for (const values of [{}, { unit: 'sat' }, every]) {
      const { url } = buildWalletRequest(values)
      for (const snippet of [walletCurlSnippet(url), walletFetchSnippet(url)]) {
        expect(snippet.split(url)).toHaveLength(2)
        expect(snippet).not.toMatch(/headers|-H\b|--header|Authorization/i)
      }
      // The URL itself: no quote, dollar, backtick, backslash, whitespace, control or non-ASCII character.
      expect(url).toMatch(/^[A-Za-z0-9\-._~:/?=&,%]+$/)
      expect(url).not.toMatch(/["'`$\\\s]/)
    }
  })

  it('never lets an unsafe value reach a URL: every string the builder rejects stays out', () => {
    for (const bad of ['"; rm -rf /; "', "'; process.exit(); '", '`id`', '$(id)', 'a b', 'a\nb', '%00', '${x}']) {
      for (const field of ['unit', 'nuts', 'include', 'changedSince', 'method', 'minScore', 'limit', 'maxInputFeePpk', 'eligible', 'includeTest']) {
        const { url, errors } = buildWalletRequest({ [field]: bad })
        expect(errors.map(e => e.field)).toEqual([field])
        expect(url).not.toMatch(/["'`$\\\s]/)
        expect(url).toBe(`${WALLET_API_BASE}/wallets/mints`)
      }
    }
  })

  it('the snippet functions refuse a URL that needs escaping', () => {
    for (const url of [`${WALLET_API_BASE}/wallets/mints?unit=a"b`, `${WALLET_API_BASE}/wallets/mints?unit=a'b`, 'https://x/`id`', 'https://x/$HOME', 'https://x/a b', '']) {
      expect(() => walletCurlSnippet(url)).toThrow()
      expect(() => walletFetchSnippet(url)).toThrow()
    }
  })
})
