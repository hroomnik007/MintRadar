// Mint change log: confirmed changes in a mint's PUBLIC data (public key, input fees, keysets, MOTD, name, description,
// contact methods, version, supported NUTs and methods). A measurement station, not an arbiter: every row is a fact with a
// source and a time; nothing here feeds the Reliability Score and no text judges a change.
//
// Hooks (no extra request to a mint is made): the successful /v1/info of the 5-minute probe (prober.ts) and the hourly
// /v1/keysets of keysetsSync.ts hand the body they already fetched to recordInfoObservation / recordKeysetsObservation.
//
// Rules (docs/claude/backend-api-and-data.md "Mint change log"):
//  - Baseline: the first observation of a mint, or of a field that was never stored, writes NO change.
//  - Confirmation: a difference becomes a change only when two consecutive successful observations agree (in-memory
//    pending state; a restart loses it, which can only delay a change, never invent one).
//  - A failed fetch, a non-2xx, a field missing from a partial answer, an empty or partly malformed keysets answer never
//    compares and never overwrites the stored state (the callers do not call in then).
//  - Stored values are normalised (trimmed, spaces collapsed, lists sorted, fees as numbers) and sanitised text: plain,
//    at most 200 characters, URLs replaced by "[link]", control characters removed. Contacts: only the method kinds and
//    the count, never a contact value.
//  - Noise control: at most MAX_CHANGES_PER_MINT_PER_DAY rows per mint and UTC day; the rest of that day is merged into
//    ONE row per change type whose new_value is MULTIPLE_CHANGES_TEXT (no counter, old_value NULL).
import { pool } from './db.js'
import { normalizeMintPubkey } from './mintPubkey.js'
import { isNutDeclaredSupported } from './shared/nutSupport.js'
import { notifyMintChanges, isNotificationServiceEnabled, type ChangeNotice } from './nostrService.js'
import type { ParsedKeyset } from './keysetsSync.js'

export const CHANGE_TYPES = [
  'pubkey_changed', 'input_fee_changed', 'keyset_added', 'keyset_removed', 'keyset_deactivated', 'keyset_reactivated',
  'keyset_final_expiry_changed', 'motd_changed', 'name_changed', 'description_changed', 'contact_changed', 'version_changed',
  'nuts_changed', 'methods_changed',
] as const
export type ChangeType = typeof CHANGE_TYPES[number]
export type ChangeSource = 'info' | 'keysets'

export const MAX_CHANGES_PER_MINT_PER_DAY = 20
export const MULTIPLE_CHANGES_TEXT = 'multiple changes'
export const TEXT_MAX = 200
export const VERSION_MAX = 100
/** The wallet API snapshot reads this many newest changes of one mint (index.ts); the list `include=changes` caps it lower. */
export const WALLET_CHANGES_PER_MINT = 50
/** The web route returns at most this many. */
export const ROUTE_CHANGES_MAX = 100

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

// ── Sanitising ──────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/g
const URL_RES = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S*/gi,
  /\b(?:mailto|nostr|lightning|bitcoin|cashu[a-z]*|data|javascript|tel):\S+/gi,
  /\bwww\.\S+/gi,
  /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*|:\d+\S*)/gi,
]

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function cap(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length > max ? chars.slice(0, max).join('').trimEnd() : s
}

/** Plain text for display: spaces collapsed, control characters removed, every URL replaced by "[link]", at most `max` characters. */
export function sanitizeText(raw: unknown, max: number = TEXT_MAX): string | null {
  if (typeof raw !== 'string') return null
  let s = collapse(raw).replace(CONTROL_RE, '')
  for (const re of URL_RES) s = s.replace(re, '[link]')
  return cap(collapse(s), max)
}

/** The version string as reported (no judgement), whitespace collapsed, control characters removed, at most VERSION_MAX characters. */
export function sanitizeVersion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  return cap(collapse(collapse(raw).replace(CONTROL_RE, '')), VERSION_MAX)
}

const TOKEN_RE = /^[a-z0-9_-]{1,32}$/

// ── /v1/info snapshot ───────────────────────────────────────────────────────

export const INFO_FIELD_TYPES = {
  pubkey: 'pubkey_changed',
  motd: 'motd_changed',
  name: 'name_changed',
  description: 'description_changed',
  description_long: 'description_changed',
  contact: 'contact_changed',
  version: 'version_changed',
  nuts: 'nuts_changed',
  methods: 'methods_changed',
} as const satisfies Record<string, ChangeType>
export type InfoField = keyof typeof INFO_FIELD_TYPES
const INFO_FIELDS = Object.keys(INFO_FIELD_TYPES) as InfoField[]
const TEXT_FIELDS = ['motd', 'name', 'description', 'description_long'] as const

/** The normalised, sanitised value of every field the /v1/info body CONTAINS in a usable form; a missing field is absent here. */
export type InfoSnapshot = Partial<Record<InfoField, string>>

function sortedUnique(items: Iterable<string>): string[] {
  return [...new Set(items)].sort()
}

function nutKeys(nuts: Obj): string {
  const keys = Object.keys(nuts).filter(k => /^\d{1,3}$/.test(k) && isNutDeclaredSupported(nuts[k])).sort((a, b) => Number(a) - Number(b))
  return keys.length === 0 ? 'none' : keys.join(', ')
}

function methodList(nuts: Obj): string {
  const out: string[] = []
  for (const [key, label] of [['4', 'mint'], ['5', 'melt']] as const) {
    const nut = nuts[key]
    const methods = isObj(nut) && Array.isArray(nut['methods']) ? nut['methods'] as unknown[] : []
    for (const m of methods) {
      if (!isObj(m) || typeof m['method'] !== 'string' || typeof m['unit'] !== 'string') continue
      const method = m['method'].trim().toLowerCase()
      const unit = m['unit'].trim().toLowerCase()
      if (TOKEN_RE.test(method) && TOKEN_RE.test(unit)) out.push(`${label}:${method}/${unit}`)
    }
  }
  const list = sortedUnique(out)
  return list.length === 0 ? 'none' : list.join(', ')
}

/** Contact METHOD kinds and the number of entries, e.g. "email, nostr (2)"; never a contact value. */
function contactSummary(list: unknown[]): string {
  const kinds: string[] = []
  let count = 0
  for (const e of list) {
    if (!isObj(e) || typeof e['method'] !== 'string') continue
    count++
    const kind = e['method'].trim().toLowerCase()
    kinds.push(TOKEN_RE.test(kind) ? kind : 'other')
  }
  return count === 0 ? 'none' : `${sortedUnique(kinds).join(', ')} (${count})`
}

export function normalizeInfo(raw: unknown): InfoSnapshot {
  const out: InfoSnapshot = {}
  if (!isObj(raw)) return out
  const pubkey = normalizeMintPubkey(raw['pubkey'])
  if (pubkey !== null) out.pubkey = pubkey
  for (const f of TEXT_FIELDS) {
    const t = sanitizeText(raw[f])
    if (t !== null) out[f] = t
  }
  const version = sanitizeVersion(raw['version'])
  if (version !== null) out.version = version
  if (Array.isArray(raw['contact'])) out.contact = contactSummary(raw['contact'])
  if (isObj(raw['nuts'])) {
    out.nuts = nutKeys(raw['nuts'])
    out.methods = methodList(raw['nuts'])
  }
  return out
}

/**
 * A stored snapshot in whatever shape older code or a hand edit left it, brought to the form normalizeInfo produces, so
 * the comparison is always normalised-to-normalised. Unknown keys and values of the wrong type are dropped (= never stored).
 */
export function normalizeStoredInfo(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isObj(raw)) return out
  for (const f of INFO_FIELDS) {
    let v = raw[f]
    if (Array.isArray(v)) v = v.map(String).join(', ')
    if (typeof v !== 'string') continue
    if (f === 'pubkey') {
      const pk = normalizeMintPubkey(v)
      if (pk !== null) out[f] = pk
    } else if (f === 'version') {
      out[f] = sanitizeVersion(v) ?? ''
    } else if (f === 'nuts' || f === 'methods') {
      const items = v.split(',').map(s => collapse(s)).filter(s => s !== '' && s !== 'none')
      out[f] = items.length === 0 ? 'none' : (f === 'nuts'
        ? [...new Set(items)].sort((a, b) => Number(a) - Number(b)).join(', ')
        : sortedUnique(items).join(', '))
    } else if (f === 'contact') {
      out[f] = collapse(v).replace(CONTROL_RE, '')
    } else {
      out[f] = sanitizeText(v) ?? ''
    }
  }
  return out
}

// ── Keysets snapshot ────────────────────────────────────────────────────────

export interface KeysetSnap {
  id: string
  unit: string
  active: boolean
  /** input_fee_ppk, or null when the mint stated no valid fee. */
  fee: number | null
  /** final_expiry as UNIX seconds, or null. */
  expiry: number | null
}

const MAX_EXPIRY_S = 32_503_680_000

export function normalizeKeysets(list: readonly Pick<ParsedKeyset, 'id' | 'unit' | 'active' | 'inputFeePpk' | 'finalExpiry'>[]): KeysetSnap[] {
  return list
    .map(k => ({
      id: k.id, unit: k.unit.toLowerCase(), active: k.active, fee: k.inputFeePpk,
      expiry: k.finalExpiry !== null && k.finalExpiry <= MAX_EXPIRY_S ? k.finalExpiry : null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** A stored keysets snapshot (also tolerating the wallet API's field names); null = never stored. */
export function normalizeStoredKeysets(raw: unknown): KeysetSnap[] | null {
  if (!Array.isArray(raw)) return null
  const out: KeysetSnap[] = []
  const seen = new Set<string>()
  for (const e of raw) {
    if (!isObj(e) || typeof e['id'] !== 'string' || e['id'] === '' || seen.has(e['id']) || typeof e['unit'] !== 'string' || typeof e['active'] !== 'boolean') continue
    seen.add(e['id'])
    const fee = e['fee'] ?? e['inputFeePpk']
    const expiry = e['expiry'] ?? e['finalExpiry']
    out.push({
      id: e['id'], unit: e['unit'].toLowerCase(), active: e['active'],
      fee: typeof fee === 'number' && Number.isFinite(fee) ? fee : (typeof fee === 'string' && /^\d+$/.test(fee) ? Number(fee) : null),
      expiry: typeof expiry === 'number' && Number.isFinite(expiry) && expiry > 0 ? expiry : null,
    })
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** unit -> the largest input fee among the ACTIVE keysets of that unit that state one. */
export function feesByUnit(list: readonly KeysetSnap[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const k of list) {
    if (!k.active || k.fee === null) continue
    m.set(k.unit, Math.max(m.get(k.unit) ?? 0, k.fee))
  }
  return m
}

function describeFees(m: ReadonlyMap<string, number>): string {
  if (m.size === 0) return 'none'
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([u, f]) => `${u}: ${f} ppk`).join(', ')
}

function describeKeyset(k: KeysetSnap): string {
  const id = sanitizeText(k.id, 80) ?? ''
  return `${id} (${k.unit}, ${k.active ? 'active' : 'inactive'}${k.fee !== null ? `, ${k.fee} ppk` : ''})`
}

function expiryText(s: number | null): string {
  return s === null ? 'none' : new Date(s * 1000).toISOString().replace('.000Z', 'Z')
}

// ── Detection ───────────────────────────────────────────────────────────────

export interface FeeDelta { unit: string; oldPpk: number | null; newPpk: number | null }

export interface DetectedChange {
  type: ChangeType
  field: string
  oldValue: string | null
  newValue: string | null
  /** When the new value was first seen (before the confirming observation), ms. */
  firstSeenAt: number
  source: ChangeSource
  /** input_fee_changed only: the units whose fee differs (for the DM; not stored). */
  fees?: FeeDelta[]
}

export interface StoredChange extends DetectedChange {
  id: number
  observedAt: Date
  /** true: counted into the per-day "multiple changes" row instead of a row of its own. */
  merged: boolean
}

export interface Pending { value: string; firstSeenAt: number }

export type Step =
  | { kind: 'baseline' }
  | { kind: 'same' }
  | { kind: 'pending'; pending: Pending }
  | { kind: 'confirmed'; firstSeenAt: number }

/** One value, one observation: the whole confirmation rule. `stored` undefined = never stored (baseline). */
export function stepValue(stored: string | undefined, pending: Pending | undefined, observed: string, now: number): Step {
  if (stored === undefined) return { kind: 'baseline' }
  if (observed === stored) return { kind: 'same' }
  if (pending !== undefined && pending.value === observed) return { kind: 'confirmed', firstSeenAt: pending.firstSeenAt }
  return { kind: 'pending', pending: { value: observed, firstSeenAt: now } }
}

export function diffKeysets(oldList: readonly KeysetSnap[], newList: readonly KeysetSnap[], firstSeenAt: number): DetectedChange[] {
  const before = new Map(oldList.map(k => [k.id, k]))
  const after = new Map(newList.map(k => [k.id, k]))
  const out: DetectedChange[] = []
  const push = (type: ChangeType, oldValue: string | null, newValue: string | null, extra: Partial<DetectedChange> = {}): void => {
    out.push({ type, field: type === 'input_fee_changed' ? 'input_fee' : 'keyset', oldValue, newValue, firstSeenAt, source: 'keysets', ...extra })
  }
  for (const k of newList) if (!before.has(k.id)) push('keyset_added', null, describeKeyset(k))
  for (const k of oldList) if (!after.has(k.id)) push('keyset_removed', describeKeyset(k), null)
  for (const k of newList) {
    const o = before.get(k.id)
    if (o && o.active && !k.active) push('keyset_deactivated', describeKeyset(o), describeKeyset(k))
  }
  for (const k of newList) {
    const o = before.get(k.id)
    if (o && !o.active && k.active) push('keyset_reactivated', describeKeyset(o), describeKeyset(k))
  }
  for (const k of newList) {
    const o = before.get(k.id)
    if (o && o.expiry !== k.expiry) push('keyset_final_expiry_changed', `${sanitizeText(k.id, 80) ?? ''}: ${expiryText(o.expiry)}`, `${sanitizeText(k.id, 80) ?? ''}: ${expiryText(k.expiry)}`)
  }
  const oldFees = feesByUnit(oldList)
  const newFees = feesByUnit(newList)
  const units = sortedUnique([...oldFees.keys(), ...newFees.keys()])
  const fees: FeeDelta[] = units
    .filter(u => oldFees.get(u) !== newFees.get(u))
    .map(u => ({ unit: u, oldPpk: oldFees.get(u) ?? null, newPpk: newFees.get(u) ?? null }))
  if (fees.length > 0) push('input_fee_changed', describeFees(oldFees), describeFees(newFees), { fees })
  return out
}

/**
 * Version of the rule the stored `info.nuts` baseline is built with. 1 = a NUT entry with `supported: false` is not a
 * supported NUT (methodology 4, 2026-10-21); rows built before have 0. A row with an older stamp gets its nuts baseline
 * replaced silently by the next successful observation (no change row), then the stamp is set.
 */
export const NUTS_RULES_VERSION = 1

export interface MintChangeState {
  info: unknown
  keysets: unknown
  /** The stamp of the row; undefined (a test double, no row) is read as current. */
  nutsRules?: number
}

export interface StatePatch {
  info?: Record<string, string>
  keysets?: KeysetSnap[]
  /** Set together with `info` when the nuts baseline was written or rebuilt under NUTS_RULES_VERSION. */
  nutsRules?: number
}

export interface ChangeDeps {
  load: (url: string) => Promise<MintChangeState>
  /** Writes the new baseline and the changes in ONE transaction; returns the rows as stored (with the per-day cap applied). */
  commit: (url: string, patch: StatePatch, changes: DetectedChange[]) => Promise<StoredChange[]>
  pending: Map<string, Pending>
  now: () => number
}

/** One successful /v1/info body. Returns the changes that were confirmed by it. */
export async function observeInfo(url: string, raw: unknown, deps: ChangeDeps): Promise<StoredChange[]> {
  const snap = normalizeInfo(raw)
  const fields = (Object.keys(snap) as InfoField[])
  if (fields.length === 0) return []
  const state = await deps.load(url)
  const stored = normalizeStoredInfo(state.info)
  const next: Record<string, string> = { ...stored }
  const changes: DetectedChange[] = []
  let dirty = false
  const now = deps.now()
  const staleNutsRules = snap.nuts !== undefined && (state.nutsRules ?? NUTS_RULES_VERSION) < NUTS_RULES_VERSION
  for (const f of fields) {
    const key = `${url}\ninfo:${f}`
    const observed = snap[f] as string
    if (f === 'nuts' && staleNutsRules) {
      // The stored list was built under an older rule: replace it without a change row, without waiting for a confirmation.
      deps.pending.delete(key)
      next[f] = observed
      dirty = true
      continue
    }
    const step = stepValue(stored[f], deps.pending.get(key), observed, now)
    if (step.kind === 'pending') { deps.pending.set(key, step.pending); continue }
    deps.pending.delete(key)
    if (step.kind === 'same') continue
    next[f] = observed
    dirty = true
    if (step.kind === 'confirmed') {
      changes.push({ type: INFO_FIELD_TYPES[f], field: f, oldValue: stored[f] ?? null, newValue: observed, firstSeenAt: step.firstSeenAt, source: 'info' })
    }
  }
  if (!dirty) return []
  return deps.commit(url, staleNutsRules ? { info: next, nutsRules: NUTS_RULES_VERSION } : { info: next }, changes)
}

/** One successful, complete /v1/keysets answer. Returns the changes that were confirmed by it. */
export async function observeKeysets(url: string, observedList: readonly KeysetSnap[], deps: ChangeDeps): Promise<StoredChange[]> {
  if (observedList.length === 0) return []
  const state = await deps.load(url)
  const stored = normalizeStoredKeysets(state.keysets)
  const key = `${url}\nkeysets`
  const signature = JSON.stringify(observedList)
  if (stored === null) {
    deps.pending.delete(key)
    return deps.commit(url, { keysets: [...observedList] }, [])
  }
  const step = stepValue(JSON.stringify(stored), deps.pending.get(key), signature, deps.now())
  if (step.kind === 'pending') { deps.pending.set(key, step.pending); return [] }
  deps.pending.delete(key)
  if (step.kind !== 'confirmed') return []
  return deps.commit(url, { keysets: [...observedList] }, diffKeysets(stored, observedList, step.firstSeenAt))
}

// ── Per-day cap ─────────────────────────────────────────────────────────────

export type Storage = 'insert' | 'insert-merged' | 'merge'

/**
 * Where one more change of this type goes: a row of its own while fewer than the daily cap exist today; after that ONE
 * "multiple changes" row per type and day (created by the first one over the cap, then only touched).
 */
export function decideStorage(rowsToday: number, hasMergedRowForType: boolean): Storage {
  if (rowsToday < MAX_CHANGES_PER_MINT_PER_DAY) return 'insert'
  return hasMergedRowForType ? 'merge' : 'insert-merged'
}

// ── Database ────────────────────────────────────────────────────────────────

const DAY_START_SQL = `(date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`

export async function loadState(url: string): Promise<MintChangeState> {
  const res = await pool.query('SELECT info, keysets, nuts_rules FROM mint_change_state WHERE url = $1', [url])
  const row = res.rows[0] as { info: unknown; keysets: unknown; nuts_rules: number } | undefined
  return { info: row?.info ?? null, keysets: row?.keysets ?? null, nutsRules: row?.nuts_rules ?? 0 }
}

export async function commitChanges(url: string, patch: StatePatch, changes: DetectedChange[]): Promise<StoredChange[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO mint_change_state (url, info, keysets, nuts_rules) VALUES ($1, $2::jsonb, $3::jsonb, COALESCE($4::int, 0))
       ON CONFLICT (url) DO UPDATE SET
         info = COALESCE($2::jsonb, mint_change_state.info),
         keysets = COALESCE($3::jsonb, mint_change_state.keysets),
         nuts_rules = COALESCE($4::int, mint_change_state.nuts_rules),
         updated_at = NOW()`,
      [url, patch.info ? JSON.stringify(patch.info) : null, patch.keysets ? JSON.stringify(patch.keysets) : null, patch.nutsRules ?? null],
    )
    const stored: StoredChange[] = []
    if (changes.length > 0) {
      let rowsToday = Number((await client.query(
        `SELECT COUNT(*)::int AS n FROM mint_changes WHERE url = $1 AND observed_at >= ${DAY_START_SQL}`, [url],
      )).rows[0]?.n ?? 0)
      for (const c of changes) {
        let merged = false
        let hasMerged = false
        if (rowsToday >= MAX_CHANGES_PER_MINT_PER_DAY) {
          hasMerged = ((await client.query(
            `SELECT id FROM mint_changes WHERE url = $1 AND change_type = $2 AND new_value = $3 AND observed_at >= ${DAY_START_SQL} LIMIT 1`,
            [url, c.type, MULTIPLE_CHANGES_TEXT],
          )).rowCount ?? 0) > 0
        }
        const how = decideStorage(rowsToday, hasMerged)
        let res
        if (how === 'merge') {
          merged = true
          res = await client.query(
            `UPDATE mint_changes SET observed_at = NOW()
              WHERE id = (SELECT id FROM mint_changes WHERE url = $1 AND change_type = $2 AND new_value = $3 AND observed_at >= ${DAY_START_SQL} ORDER BY id LIMIT 1)
              RETURNING id, observed_at`,
            [url, c.type, MULTIPLE_CHANGES_TEXT],
          )
        } else {
          merged = how === 'insert-merged'
          res = await client.query(
            `INSERT INTO mint_changes (url, change_type, field, old_value, new_value, observed_at, first_seen_at, source)
             VALUES ($1, $2, $3, $4, $5, NOW(), to_timestamp($6::double precision / 1000.0), $7)
             RETURNING id, observed_at`,
            [url, c.type, c.field, merged ? null : c.oldValue, merged ? MULTIPLE_CHANGES_TEXT : c.newValue, c.firstSeenAt, c.source],
          )
          rowsToday++
        }
        const row = res.rows[0] as { id: string | number; observed_at: Date }
        stored.push({ ...c, id: Number(row.id), observedAt: row.observed_at, merged })
      }
    }
    await client.query('COMMIT')
    return stored
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

const pendingStore = new Map<string, Pending>()
const defaultDeps: ChangeDeps = { load: loadState, commit: commitChanges, pending: pendingStore, now: () => Date.now() }

/** Only a confirmed public key or input fee change is ever sent as a DM; a merged row is not (it is a summary). */
export function noticesOf(changes: readonly StoredChange[]): ChangeNotice[] {
  const out: ChangeNotice[] = []
  for (const c of changes) {
    if (c.merged) continue
    if (c.type === 'pubkey_changed') out.push({ id: c.id, type: 'pubkey_changed', observedAt: c.observedAt })
    else if (c.type === 'input_fee_changed' && c.fees) {
      out.push({ id: c.id, type: 'input_fee_changed', observedAt: c.observedAt, fees: c.fees.map(f => ({ unit: f.unit, old: f.oldPpk, new: f.newPpk })) })
    }
  }
  return out
}

async function dispatch(url: string, changes: StoredChange[], notify: (url: string, n: ChangeNotice[]) => Promise<void>, enabled: boolean): Promise<void> {
  if (changes.length === 0) return
  console.log(`[changes] ${url}: ${changes.map(c => c.type).join(', ')}`)
  const notices = noticesOf(changes)
  if (enabled && notices.length > 0) await notify(url, notices)
}

/** Called by the probe after a successful /v1/info. Never throws: a failure here must not touch the probe result. */
export async function recordInfoObservation(url: string, raw: unknown, deps: ChangeDeps = defaultDeps): Promise<void> {
  try {
    await dispatch(url, await observeInfo(url, raw, deps), notifyMintChanges, isNotificationServiceEnabled())
  } catch (err) {
    console.error(`[changes] info observation failed for ${url}:`, err)
  }
}

/** Called by the keysets job after a complete, stored /v1/keysets answer. Never throws. */
export async function recordKeysetsObservation(
  url: string, parsed: { keysets: readonly ParsedKeyset[]; skipped: number; ignored: number }, deps: ChangeDeps = defaultDeps,
): Promise<void> {
  // A partly malformed or truncated list is a partial answer: it never compares.
  if (parsed.skipped > 0 || parsed.ignored > 0 || parsed.keysets.length === 0) return
  try {
    await dispatch(url, await observeKeysets(url, normalizeKeysets(parsed.keysets), deps), notifyMintChanges, isNotificationServiceEnabled())
  } catch (err) {
    console.error(`[changes] keysets observation failed for ${url}:`, err)
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface ChangeRow {
  type: string
  field: string
  oldValue: string | null
  newValue: string | null
  observedAt: string
  firstSeenAt: string
}

const iso = (v: Date | string): string => new Date(v).toISOString()

function rowOf(r: Record<string, unknown>): ChangeRow {
  return {
    type: r['change_type'] as string,
    field: r['field'] as string,
    oldValue: (r['old_value'] as string | null) ?? null,
    newValue: (r['new_value'] as string | null) ?? null,
    observedAt: iso(r['observed_at'] as Date | string),
    firstSeenAt: iso(r['first_seen_at'] as Date | string),
  }
}

/** The newest changes of ONE mint (the web route) and when tracking of it started. */
export async function listMintChanges(url: string, limit: number = ROUTE_CHANGES_MAX): Promise<{ trackingSince: string | null; changes: ChangeRow[] }> {
  const [rows, state] = await Promise.all([
    pool.query(
      `SELECT change_type, field, old_value, new_value, observed_at, first_seen_at
         FROM mint_changes WHERE url = $1 ORDER BY observed_at DESC, id DESC LIMIT $2`, [url, limit]),
    pool.query('SELECT tracking_since FROM mint_change_state WHERE url = $1', [url]),
  ])
  const since = state.rows[0]?.tracking_since as Date | string | undefined
  return { trackingSince: since ? iso(since) : null, changes: (rows.rows as Record<string, unknown>[]).map(rowOf) }
}
