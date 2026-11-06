// Data layer of the /for-wallets request builder: a machine-readable description of the 13 list query parameters
// of GET /wallets/mints, a function that validates the values a user set and composes the URL, and the curl and
// fetch snippets. Pure: no React, no network, no storage, no side effects.
//
// Every rule below is taken from parseWalletListQuery (backend/src/walletApi.ts) and docs/openapi/wallets-v1.yaml;
// src/__tests__/walletRequestBuilder.test.ts compares them with the real parser and the OpenAPI file in both
// directions. Because every accepted value is validated against a closed character set, a generated URL never
// contains a quote, a dollar sign, a backtick, a backslash or whitespace, so it can sit inside "..." and '...' as is.

import { WALLET_API_BASE } from '@/constants/forWalletsPage'

export type WalletParamKind = 'text' | 'integer' | 'flag' | 'tri-state' | 'enum' | 'number list' | 'enum list' | 'time'

export interface WalletRequestParam {
  /** The query parameter name; the list has the order of WALLET_QUERY_PARAMS. */
  name: string
  kind: WalletParamKind
  /** The value when the parameter is absent, as the API defines it (null: no default, no filter). */
  default: boolean | number | null
  /** Inclusive bounds of an integer (kind integer). */
  min?: number
  max?: number
  /** Longest accepted text, in characters (checked before any pattern is run). */
  maxLength?: number
  /** Allowed values of an enum or an enum list, in the order the URL writes them. */
  values?: readonly string[]
  /** Most items of a list. */
  maxItems?: number
  /** Digits per item of a number list. */
  maxDigits?: number
}

export const WALLET_REQUEST_PARAMS: readonly WalletRequestParam[] = [
  { name: 'unit', kind: 'text', default: null, maxLength: 16 },
  { name: 'minScore', kind: 'integer', default: null, min: 0, max: 100 },
  { name: 'includeOffline', kind: 'flag', default: false },
  { name: 'includeArchived', kind: 'flag', default: false },
  { name: 'includeTest', kind: 'flag', default: false },
  { name: 'includeUnscored', kind: 'flag', default: false },
  { name: 'nuts', kind: 'number list', default: null, maxItems: 32, maxDigits: 3 },
  { name: 'eligible', kind: 'tri-state', default: null },
  { name: 'method', kind: 'enum', default: null, values: ['bolt11', 'bolt12', 'onchain'] },
  { name: 'maxInputFeePpk', kind: 'integer', default: null, min: 0, max: 1_000_000 },
  { name: 'include', kind: 'enum list', default: null, values: ['facts', 'keysets', 'methods', 'breakdown', 'changes'] },
  { name: 'changedSince', kind: 'time', default: null, maxLength: 40 },
  { name: 'limit', kind: 'integer', default: 100, min: 1, max: 200 },
]

export type WalletParamName =
  | 'unit' | 'minScore' | 'includeOffline' | 'includeArchived' | 'includeTest' | 'includeUnscored' | 'nuts'
  | 'eligible' | 'method' | 'maxInputFeePpk' | 'include' | 'changedSince' | 'limit'

/** What the user set. undefined, '' and an empty list mean "not set"; a flag set to false is "not set" too. */
export type WalletRequestValues = Partial<Record<WalletParamName, string | boolean | readonly string[]>>

export interface WalletRequestError {
  field: WalletParamName
  message: string
}

export interface WalletRequest {
  url: string
  errors: WalletRequestError[]
}

/** The longest raw text any list field may hold before it is split (32 numbers of 3 digits with commas and spaces). */
const MAX_LIST_TEXT = 256
const MAX_INTEGER_DIGITS = 7

// Same pattern as the backend's ISO_SINCE_RE; no nested quantifiers, and the input is at most 40 characters.
const ISO_SINCE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/
const UNIT_RE = /^[A-Za-z0-9_-]+$/
const DIGITS_RE = /^\d+$/

const isSet = (v: unknown): boolean =>
  v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)

/** Splits a list the user typed (or already split) into trimmed items; null when it is too long to be valid. */
function listItems(v: string | boolean | readonly string[]): string[] | null {
  if (typeof v === 'boolean') return null
  if (typeof v === 'string') return v.length > MAX_LIST_TEXT ? null : v.split(',').map(s => s.trim())
  if (v.length > 64) return null
  const items: string[] = []
  for (const x of v) {
    if (typeof x !== 'string' || x.length > 16) return null
    items.push(x.trim())
  }
  return items
}

/** ISO 8601 (date, or date and time WITH Z or an offset) or UNIX seconds (9 to 11 digits); same rule as the backend. */
function isValidTime(v: string): boolean {
  if (v.length >= 9 && v.length <= 11 && DIGITS_RE.test(v)) return true
  if (!ISO_SINCE_RE.test(v)) return false
  return Number.isFinite(Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v))
}

/** encodeURIComponent, with commas and colons kept literal (a + stays %2B). */
const encode = (v: string): string => encodeURIComponent(v).replace(/%2C/g, ',').replace(/%3A/g, ':')

type Outcome = { set: false } | { set: true; value: string } | { error: string }
const UNSET: Outcome = { set: false }
const ok = (value: string): Outcome => ({ set: true, value })
const bad = (error: string): Outcome => ({ error })

function checkOne(p: WalletRequestParam, raw: string | boolean | readonly string[]): Outcome {
  switch (p.kind) {
    case 'flag': {
      if (raw === false) return UNSET
      if (raw === true || raw === 'true') return ok('true')
      return bad(`${p.name} must be true, or left unset`)
    }
    case 'tri-state': {
      if (raw === true || raw === 'true') return ok('true')
      if (raw === false || raw === 'false') return ok('false')
      return bad(`${p.name} must be true, false, or left unset`)
    }
    case 'text': {
      if (typeof raw !== 'string') return bad(`${p.name} must be text`)
      const v = raw.trim()
      if (v.length > (p.maxLength as number) || !UNIT_RE.test(v)) {
        return bad(`${p.name} must be 1 to ${p.maxLength} letters, digits, "_" or "-"`)
      }
      return ok(v)
    }
    case 'integer': {
      const range = `${p.name} must be an integer from ${p.min} to ${p.max}`
      if (typeof raw !== 'string') return bad(range)
      const v = raw.trim()
      if (v.length > MAX_INTEGER_DIGITS || !DIGITS_RE.test(v)) return bad(range)
      const n = Number(v)
      if (n < (p.min as number) || n > (p.max as number)) return bad(range)
      return ok(String(n))
    }
    case 'enum': {
      const allowed = p.values as readonly string[]
      if (typeof raw !== 'string' || !allowed.includes(raw.trim())) return bad(`${p.name} must be one of ${allowed.join(', ')}`)
      return ok(raw.trim())
    }
    case 'number list': {
      const msg = `${p.name} must be 1 to ${p.maxItems} comma-separated NUT numbers of 1 to ${p.maxDigits} digits, for example 4,5`
      const items = listItems(raw)
      if (!items || items.length > (p.maxItems as number)) return bad(msg)
      const numbers = new Set<number>()
      for (const it of items) {
        if (it.length < 1 || it.length > (p.maxDigits as number) || !DIGITS_RE.test(it)) return bad(msg)
        numbers.add(Number(it))
      }
      return ok([...numbers].sort((a, b) => a - b).join(','))
    }
    case 'enum list': {
      const allowed = p.values as readonly string[]
      const msg = `${p.name} must be a comma-separated list of: ${allowed.join(', ')}`
      const items = listItems(raw)
      if (!items || !items.every(i => allowed.includes(i))) return bad(msg)
      return ok(allowed.filter(a => items.includes(a)).join(','))
    }
    case 'time': {
      const msg = `${p.name} must be an ISO 8601 time with Z or an offset, a date such as 2026-10-20, or UNIX seconds (9 to 11 digits)`
      if (typeof raw !== 'string') return bad(msg)
      const v = raw.trim()
      if (v.length > (p.maxLength as number) || !isValidTime(v)) return bad(msg)
      return ok(v)
    }
  }
}

/** Validates what the user set and composes the request URL; invalid fields are reported and left out of the URL. */
export function buildWalletRequest(values: WalletRequestValues): WalletRequest {
  const parts: string[] = []
  const errors: WalletRequestError[] = []
  for (const p of WALLET_REQUEST_PARAMS) {
    const raw = values[p.name as WalletParamName]
    if (!isSet(raw)) continue
    const r = checkOne(p, raw as string | boolean | readonly string[])
    if ('error' in r) errors.push({ field: p.name as WalletParamName, message: r.error })
    else if (r.set) parts.push(`${p.name}=${encode(r.value)}`)
  }
  return { url: `${WALLET_API_BASE}/wallets/mints${parts.length > 0 ? `?${parts.join('&')}` : ''}`, errors }
}

// The snippets accept only a URL made of characters that need no escaping in a shell or a JS string literal.
const SAFE_URL_RE = /^[A-Za-z0-9\-._~:/?=&,%]{1,2048}$/

function assertSafeUrl(url: string): void {
  if (!SAFE_URL_RE.test(url)) throw new Error('walletRequestBuilder: URL contains a character that needs escaping')
}

/** `curl -s "<url>"`; the URL has no character that needs escaping inside double quotes. */
export function walletCurlSnippet(url: string): string {
  assertSafeUrl(url)
  return `curl -s "${url}"`
}

/** The fetch example of the /for-wallets page ("list-fetch") for any URL; the URL sits in single quotes. */
export function walletFetchSnippet(url: string): string {
  assertSafeUrl(url)
  return `const res = await fetch('${url}')
if (!res.ok) throw new Error((await res.json()).error.message)
const { methodology, generatedAt, mints } = await res.json()
for (const m of mints) {
  console.log(m.score, m.name ?? new URL(m.url).hostname, m.status)
}`
}
