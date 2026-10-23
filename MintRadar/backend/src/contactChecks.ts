// Facts about the contact entries a mint lists in its /v1/info: is the value well formed, and for an e-mail address does its
// domain have mail records in DNS. A measurement, not a verdict: nothing here feeds the Reliability Score, the status or a
// notification, and the Contact row of the score still means "the mint lists a contact".
//
// Privacy rules (tests/contactChecks.test.ts has a canary for each):
//  - the contact VALUE and its domain are used in memory only; what is stored is { kind, formatValid, domainResolves,
//    checkedAt } per entry plus the rules version the result was computed with (stored only, never returned), nothing else;
//  - no HTTP request of any kind is made to a contact value (a url is checked for its shape only);
//  - the only network traffic is a DNS query (MX, then A/AAAA) for the domain of an e-mail address or of a NIP-05 style
//    nostr identifier (local@domain), through the system resolver, never a connection to that domain: no request to
//    /.well-known/nostr.json, no relay;
//  - no log line or error message carries a value or a domain (a DNS failure is reduced to "unknown").
import { Resolver } from 'dns/promises'
import { isIP } from 'net'
import { domainToASCII } from 'url'
import { nip19 } from 'nostr-tools'
import { pool } from './db.js'
import { hasNulByte } from './hostnameGuard.js'

/**
 * The version of the format rules. Stored with every result (`rules`); a stored result of another version is recomputed
 * at the next successful probe of the mint, once (the new result carries the current version). Raise it whenever a rule
 * changes what formatValid or domainResolves can say. 2: nostr also accepts nprofile, an optional "nostr:" prefix,
 * all-uppercase bech32 and NIP-05 style local@domain (W6a correction). 3: an e-mail domain must be a bare host name
 * (a trailing path, port, query or fragment no longer passes).
 */
export const CONTACT_RULES_VERSION = 3
export const CONTACT_CHECK_MAX_EMAILS = 3
/** Entries read from one /v1/info (the rest is ignored). */
export const CONTACT_CHECK_MAX_ENTRIES = 10
export const CONTACT_CHECK_VALUE_MAX = 300
/** A mint is re-checked at most this often unless the kinds of its contact entries changed. */
export const CONTACT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const DOMAIN_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DOMAIN_CACHE_MAX = 500
/**
 * One DNS query. An attempt is at most two queries in a row (MX, then A and AAAA side by side), and a lookup is at most two
 * attempts, so the worst case is 4 x DNS_TIMEOUT_MS: that must stay below DNS_TOTAL_MS or the overall deadline cuts the
 * second attempt off (a test pins it).
 */
export const DNS_TIMEOUT_MS = 2000
/** The one overall deadline of a domain lookup, both attempts included. */
export const DNS_TOTAL_MS = 9000
export const DNS_CONCURRENCY = 5
/** Domains waiting for a free lookup slot; beyond this a domain stays unknown instead of queueing without bound. */
export const DNS_QUEUE_MAX = 500

export const CONTACT_KINDS = ['email', 'nostr', 'twitter', 'x', 'telegram', 'signal', 'url', 'other'] as const
export type ContactKind = typeof CONTACT_KINDS[number]

export interface ContactCheck {
  kind: ContactKind
  formatValid: boolean
  /**
   * true/false: DNS answered; null: not applicable (not an e-mail, not a public domain) or the lookup failed or timed out.
   * A check that could not be completed keeps an earlier true for up to 48 h (then checkedAt is the time of that earlier
   * answer, see keepKnownTrue); a real false always replaces it.
   */
  domainResolves: boolean | null
  checkedAt: string
}

// ── Kinds ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The kind the mint states, mapped to the fixed list above ("website" is the url kind); anything else is "other". */
export function kindOf(method: unknown): ContactKind {
  if (typeof method !== 'string') return 'other'
  const m = method.trim().toLowerCase()
  if (m === 'website' || m === 'url') return 'url'
  return (CONTACT_KINDS as readonly string[]).includes(m) && m !== 'other' ? m as ContactKind : 'other'
}

// ── Names ────────────────────────────────────────────────────────────────────────────────────────────────────────

const RESERVED_TLDS = new Set([
  'localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'home', 'corp', 'private', 'test', 'example',
  'invalid', 'onion', 'arpa', 'alt',
])
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org']
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

/** A domain name the public DNS can answer for: at least two LDH labels, a non-numeric, non-reserved TLD, no IP literal. */
export function isPublicDomainName(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (h.length === 0 || h.length > 253) return false
  if (h.startsWith('[') || isIP(h) !== 0) return false
  const labels = h.split('.')
  if (labels.length < 2) return false
  if (!labels.every(l => LABEL_RE.test(l))) return false
  const tld = labels[labels.length - 1] as string
  if (!TLD_RE.test(tld) || RESERVED_TLDS.has(tld)) return false
  return !RESERVED_DOMAINS.some(d => h === d || h.endsWith(`.${d}`))
}

// ── Format checks ────────────────────────────────────────────────────────────────────────────────────────────────

const LOCAL_RE = /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+(?:\.[\p{L}\p{N}!#$%&'*+/=?^_`{|}~-]+)*$/u
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Syntax of an e-mail address (dot-atom local part, a domain of LDH labels or an IP literal in brackets; quoted local
 * parts are not supported). `domain` is the ASCII (punycode) form when the syntax is valid and the domain is a name.
 */
export function parseEmail(value: string): { valid: boolean; domain: string | null } {
  const v = value.trim()
  const invalid = { valid: false, domain: null }
  if (v.length === 0 || v.length > 254) return invalid
  const at = v.indexOf('@')
  if (at < 1 || at !== v.lastIndexOf('@')) return invalid
  const local = v.slice(0, at)
  const domainRaw = v.slice(at + 1)
  if (local.length > 64 || !LOCAL_RE.test(local)) return invalid
  if (domainRaw.startsWith('[') && domainRaw.endsWith(']')) {
    const inner = domainRaw.slice(1, -1).replace(/^IPv6:/i, '')
    return isIP(inner) !== 0 ? { valid: true, domain: null } : invalid
  }
  // domainToASCII parses a URL host and would drop a path, port or query: only a bare name goes in.
  if (/[\s/\\?#:@[\]]/.test(domainRaw)) return invalid
  const ascii = domainToASCII(domainRaw).toLowerCase().replace(/\.$/, '')
  if (ascii.length === 0 || ascii.length > 253 || isIP(ascii) !== 0) return invalid
  if (!ascii.split('.').every(l => LABEL_RE.test(l))) return invalid
  return { valid: true, domain: ascii }
}

const NIP05_LOCAL_RE = /^[a-z0-9._-]+$/i

export interface NostrContact {
  valid: boolean
  /** The ASCII domain of a NIP-05 style identifier (local@domain), the only thing that is looked up; null otherwise. */
  domain: string | null
}

/**
 * The forms of a nostr contact that are recognised, after trimming whitespace and removing an optional "nostr:" prefix:
 * npub or nprofile with a valid bech32 checksum (all lower or all upper case; mixed case is invalid as BIP-173 says) and
 * a 32-byte public key, 64 hex characters, or a NIP-05 style local@domain (local part a-z0-9-_. only, public domain
 * name). Nothing is requested: no relay, no /.well-known/nostr.json.
 */
export function parseNostrContact(value: string): NostrContact {
  const none: NostrContact = { valid: false, domain: null }
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > CONTACT_CHECK_VALUE_MAX) return none
  const v = trimmed.replace(/^nostr:/i, '')
  if (/^[0-9a-f]{64}$/i.test(v)) return { valid: true, domain: null }
  if (/^(?:npub|nprofile)1/i.test(v)) {
    if (v !== v.toLowerCase() && v !== v.toUpperCase()) return none
    try {
      const d = nip19.decode(v.toLowerCase())
      if (d.type === 'npub') return { valid: /^[0-9a-f]{64}$/.test(d.data), domain: null }
      if (d.type === 'nprofile') return { valid: /^[0-9a-f]{64}$/.test(d.data.pubkey), domain: null }
    } catch { /* not a valid bech32 string */ }
    return none
  }
  const at = v.indexOf('@')
  if (at < 1 || at !== v.lastIndexOf('@')) return none
  if (!NIP05_LOCAL_RE.test(v.slice(0, at))) return none
  const host = v.slice(at + 1)
  // domainToASCII parses a URL host and would drop a path, port or query: only a bare name goes in.
  if (/[\s/\\?#:@[\]]/.test(host)) return none
  const ascii = domainToASCII(host).toLowerCase().replace(/\.$/, '')
  return isPublicDomainName(ascii) ? { valid: true, domain: ascii } : none
}

/** https URL with a public host name. Shape only: nothing is fetched and no name is resolved. */
export function isValidContactUrl(value: string): boolean {
  const v = value.trim()
  if (v.length === 0 || v.length > CONTACT_CHECK_VALUE_MAX) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && isPublicDomainName(u.hostname)
  } catch { return false }
}

/** A handle (twitter, telegram, signal, anything else): printable text of a sane length. */
export function isValidHandle(value: string): boolean {
  const v = value.trim()
  return v.length > 0 && v.length <= 200 && !CONTROL_RE.test(v)
}

// ── Domain lookups (DNS only) ────────────────────────────────────────────────────────────────────────────────────

/** true: mail records (MX, else A/AAAA); false: DNS says there are none; null: could not tell. */
export type MailLookup = (domain: string) => Promise<boolean | null>

type Answer = { kind: 'ok'; count: number; list: unknown[] } | { kind: 'none' } | { kind: 'error' }

async function answer(run: () => Promise<unknown[]>): Promise<Answer> {
  try {
    const list = await run()
    return list.length > 0 ? { kind: 'ok', count: list.length, list } : { kind: 'none' }
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    return code === 'ENODATA' || code === 'ENOTFOUND' ? { kind: 'none' } : { kind: 'error' }
  }
}

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

let resolver: Resolver | null = null

/** The system resolver, one query per name and type, a short timeout. Errors are reduced to "unknown" (null). */
async function lookupOnce(domain: string): Promise<boolean | null> {
  try {
    resolver ??= new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 })
    const r = resolver
    const mx = await answer(() => r.resolveMx(domain))
    if (mx.kind === 'error') return null
    if (mx.kind === 'ok') {
      // RFC 7505 null MX ("0 ."): the domain states it takes no mail.
      return mx.list.some(e => {
        const ex = (e as { exchange?: unknown }).exchange
        return typeof ex === 'string' && ex !== '' && ex !== '.'
      })
    }
    const [a, aaaa] = await Promise.all([answer(() => r.resolve4(domain)), answer(() => r.resolve6(domain))])
    if (a.kind === 'ok' || aaaa.kind === 'ok') return true
    return a.kind === 'none' && aaaa.kind === 'none' ? false : null
  } catch {
    return null
  }
}

/**
 * One immediate retry when the first attempt could not tell (null: timeout, SERVFAIL, a throwing resolver); a definite
 * answer (true/false, including NXDOMAIN/ENODATA) is never asked twice. Both attempts share the one overall deadline.
 */
export const resolveMailDomain: MailLookup = (domain) => hasNulByte(domain) ? Promise.resolve(null) : withDeadline((async () => {
  const first = await lookupOnce(domain)
  return first !== null ? first : lookupOnce(domain)
})(), DNS_TOTAL_MS, null)

export interface DomainChecker {
  /** Never throws. Only definite answers are cached. */
  check(domain: string): Promise<boolean | null>
  readonly cacheSize: number
}

export function createDomainChecker(opts: {
  lookup?: MailLookup
  now?: () => number
  concurrency?: number
  ttlMs?: number
  maxEntries?: number
  queueMax?: number
} = {}): DomainChecker {
  const lookup = opts.lookup ?? resolveMailDomain
  const now = opts.now ?? Date.now
  const concurrency = opts.concurrency ?? DNS_CONCURRENCY
  const ttlMs = opts.ttlMs ?? DOMAIN_CACHE_TTL_MS
  const maxEntries = opts.maxEntries ?? DOMAIN_CACHE_MAX
  const queueMax = opts.queueMax ?? DNS_QUEUE_MAX
  const cache = new Map<string, { at: number; value: boolean }>()
  const inflight = new Map<string, Promise<boolean | null>>()
  const waiters: Array<() => void> = []
  let active = 0

  async function acquire(): Promise<boolean> {
    if (active < concurrency) { active++; return true }
    if (waiters.length >= queueMax) return false
    await new Promise<void>(resolve => waiters.push(resolve))
    return true // the slot was handed over by release(); `active` was not decremented
  }
  function release(): void {
    const next = waiters.shift()
    if (next) next()
    else active--
  }
  async function run(domain: string): Promise<boolean | null> {
    if (!(await acquire())) return null
    try {
      const v = await lookup(domain)
      return v === true || v === false ? v : null
    } catch {
      return null
    } finally {
      release()
    }
  }

  return {
    get cacheSize() { return cache.size },
    check(domain) {
      // A name with a NUL byte is "could not be checked" (null), never a lookup and never cached.
      if (hasNulByte(domain)) return Promise.resolve(null)
      const hit = cache.get(domain)
      if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.value)
      const pending = inflight.get(domain)
      if (pending) return pending
      const p = run(domain).then(v => {
        if (v !== null) {
          cache.delete(domain)
          cache.set(domain, { at: now(), value: v })
          while (cache.size > maxEntries) cache.delete(cache.keys().next().value as string)
        }
        return v
      }).finally(() => { inflight.delete(domain) })
      inflight.set(domain, p)
      return p
    },
  }
}

const defaultChecker = createDomainChecker()

// ── Per mint ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface Entry { kind: ContactKind; value: string }

/** The entries to check: at most CONTACT_CHECK_MAX_ENTRIES read, at most CONTACT_CHECK_MAX_EMAILS e-mails kept. */
export function entriesOf(raw: unknown): Entry[] {
  if (!Array.isArray(raw)) return []
  const out: Entry[] = []
  let emails = 0
  for (const e of raw.slice(0, CONTACT_CHECK_MAX_ENTRIES)) {
    if (e === null || typeof e !== 'object') continue
    const rec = e as Record<string, unknown>
    const kind = kindOf(rec['method'])
    if (kind === 'email' && ++emails > CONTACT_CHECK_MAX_EMAILS) continue
    const info = rec['info']
    out.push({ kind, value: typeof info === 'string' ? info.slice(0, CONTACT_CHECK_VALUE_MAX + 1) : '' })
  }
  return out
}

async function checkEntry(entry: Entry, checkedAt: string, domains: DomainChecker): Promise<ContactCheck> {
  const { kind, value } = entry
  if (kind === 'email') {
    const parsed = parseEmail(value)
    const lookupable = parsed.valid && parsed.domain !== null && isPublicDomainName(parsed.domain)
    const domainResolves = lookupable ? await domains.check(parsed.domain as string) : null
    return { kind, formatValid: parsed.valid, domainResolves, checkedAt }
  }
  if (kind === 'nostr') {
    const nostr = parseNostrContact(value)
    // A NIP-05 style identifier gets the same DNS-only check as an e-mail domain; nothing else is asked.
    const domainResolves = nostr.domain !== null ? await domains.check(nostr.domain) : null
    return { kind, formatValid: nostr.valid, domainResolves, checkedAt }
  }
  const formatValid = kind === 'url' ? isValidContactUrl(value) : isValidHandle(value)
  return { kind, formatValid, domainResolves: null, checkedAt }
}

export async function computeContactChecks(
  raw: unknown, opts: { now?: () => number; domains?: DomainChecker } = {},
): Promise<ContactCheck[]> {
  const domains = opts.domains ?? defaultChecker
  const checkedAt = new Date((opts.now ?? Date.now)()).toISOString()
  return Promise.all(entriesOf(raw).map(e => checkEntry(e, checkedAt, domains)))
}

/** The stored column in whatever shape it holds, as ContactCheck[]; null when it is missing or malformed. */
export function readStoredContactChecks(raw: unknown): ContactCheck[] | null {
  if (!Array.isArray(raw)) return null
  const out: ContactCheck[] = []
  for (const e of raw) {
    if (e === null || typeof e !== 'object') return null
    const r = e as Record<string, unknown>
    const kind = r['kind']
    const checkedAt = r['checkedAt']
    if (typeof kind !== 'string' || !(CONTACT_KINDS as readonly string[]).includes(kind)) return null
    if (typeof r['formatValid'] !== 'boolean') return null
    if (r['domainResolves'] !== null && typeof r['domainResolves'] !== 'boolean') return null
    if (typeof checkedAt !== 'string' || !Number.isFinite(Date.parse(checkedAt))) return null
    out.push({ kind: kind as ContactKind, formatValid: r['formatValid'], domainResolves: r['domainResolves'] as boolean | null, checkedAt })
  }
  return out
}

/** How long an earlier true is kept when a later lookup could not tell: two re-check intervals, so one missed daily check is bridged. */
export const DOMAIN_KEEP_TRUE_MS = 2 * CONTACT_CHECK_INTERVAL_MS

/**
 * A lookup that could not be completed (null) must not wipe a domainResolves that was true: for up to 48 h after the last real
 * answer the entry keeps true and that answer's checkedAt (so the window cannot restart with every failed check). Entries are
 * matched by position and kind; only a still well-formed entry is carried over. A real false or true is never touched, and
 * after 48 h the null stands. No value or domain is involved: only what is already stored is read.
 */
export function keepKnownTrue(next: ContactCheck[], stored: ContactCheck[] | null, now: number): ContactCheck[] {
  if (stored === null) return next
  return next.map((c, i) => {
    const prev = stored[i]
    if (c.domainResolves !== null || !c.formatValid || prev === undefined) return c
    if (prev.kind !== c.kind || prev.domainResolves !== true) return c
    const age = now - Date.parse(prev.checkedAt)
    return age >= 0 && age < DOMAIN_KEEP_TRUE_MS ? { ...c, domainResolves: true, checkedAt: prev.checkedAt } : c
  })
}

const signature = (kinds: readonly string[]): string => [...kinds].sort().join(',')

/** true when every stored entry carries the current rules version (a stored column that is not an array has none). */
export function storedRulesCurrent(storedRaw: unknown): boolean {
  return Array.isArray(storedRaw) && storedRaw.every(e => (e as { rules?: unknown } | null)?.rules === CONTACT_RULES_VERSION)
}

/**
 * Due when nothing is stored yet, the stored result was computed with other rules, the kinds of the entries changed, or the
 * oldest check is 24 h old. A rules change therefore costs one recheck per mint: the new result carries the new version.
 */
export function isCheckDue(stored: ContactCheck[] | null, entries: readonly Entry[], now: number, rulesCurrent = true): boolean {
  if (entries.length === 0) return stored !== null && stored.length > 0
  if (stored === null || stored.length === 0) return true
  if (!rulesCurrent) return true
  if (signature(stored.map(c => c.kind)) !== signature(entries.map(e => e.kind))) return true
  const oldest = Math.min(...stored.map(c => Date.parse(c.checkedAt)))
  return now - oldest >= CONTACT_CHECK_INTERVAL_MS
}

const running = new Set<string>()

/**
 * Called by the probe after a successful /v1/info, NOT awaited there. Best effort: it never rejects, never touches the
 * probe result, and logs no value (a fixed line, no error text).
 */
export async function scheduleContactChecks(
  url: string, rawContact: unknown, storedRaw: unknown,
  opts: { now?: () => number; domains?: DomainChecker } = {},
): Promise<void> {
  if (running.has(url)) return
  running.add(url)
  try {
    const now = (opts.now ?? Date.now)()
    if (!isCheckDue(readStoredContactChecks(storedRaw), entriesOf(rawContact), now, storedRulesCurrent(storedRaw))) return
    const checks = keepKnownTrue(await computeContactChecks(rawContact, opts), storedRulesCurrent(storedRaw) ? readStoredContactChecks(storedRaw) : null, now)
    await pool.query('UPDATE mints SET contact_checks = $1::jsonb WHERE url = $2', [JSON.stringify(checks.map(c => ({ ...c, rules: CONTACT_RULES_VERSION }))), url])
  } catch {
    console.error('[contact-checks] check or store failed')
  } finally {
    running.delete(url)
  }
}

/** What the probe calls: starts the checks and returns at once; nothing, not even a synchronous throw, reaches the caller. */
export function queueContactChecks(url: string, rawContact: unknown, storedRaw: unknown): void {
  try {
    void scheduleContactChecks(url, rawContact, storedRaw).catch(() => undefined)
  } catch {
    // Best effort: a failure here must never reach the probe.
  }
}
