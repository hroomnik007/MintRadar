// Hourly collection of every online mint's keysets (GET /v1/keysets) and NUT-02 id verification (GET /v1/keys/{id}),
// stored in mint_keysets. Data collection only: nothing here feeds the Reliability Score and no endpoint reads it yet.
//
// Schedule: a cron tick every 5 minutes, offset from the probe cycle (cron.ts). Every mint has ONE fixed slot of
// KEYSETS_SLOTS_PER_HOUR (a hash of its URL), so each mint is visited once per hour and the load is spread over the
// whole hour; inside a tick the mints go one at a time after a random start offset. A tick right after a suspected
// vantage outage (probeCycle.ts) does nothing.
//
// Failure rule (the same principle as mints.pubkey / nuts_limits, which a failed probe never overwrites): any failure
// of the keysets request (network, status, size, bad JSON, schema surprise) writes NOTHING, so the stored rows and
// last_checked_at stay as they were. A keyset that is no longer listed stays in the table; only last_seen_at stops
// advancing. A verdict of "id does not match the keys" is stored only after two consecutive checks agree (a
// single odd response must never become a stored conclusion); until then the previous id_valid stays.
import { createHash } from 'node:crypto'
import { pool } from './db.js'
import { safeFetch, readJsonLimited, RESPONSE_CAPS } from './ssrf.js'
import { classifyKeysetId, verifyKeysetId, type KeysetIdVersion, type KeysetKeys } from './keysetId.js'
import { recordKeysetsObservation } from './mintChanges.js'

export const KEYSETS_SLOTS_PER_HOUR = 12
/** Hard cap on keysets processed per mint; the rest is ignored (counted in the log line). */
export const KEYSETS_MAX_PER_MINT = 32
export const KEYSETS_FETCH_TIMEOUT_MS = 10_000
export const KEYSETS_TICK_JITTER_MAX_MS = 45_000
export const KEYSETS_MINT_PAUSE_MS = 1_000
/** A vantage outage classified this recently (the previous probe cycle) skips the tick. */
export const KEYSETS_VANTAGE_SKIP_MS = 10 * 60_000
/** A mint counts as online when its newest history row, not older than this, says so. */
const ONLINE_WINDOW_MINUTES = 15

const MAX_ID_LEN = 80
const MAX_KEYS_PER_KEYSET = 128
/** final_expiry above this (year 3000) is stored as NULL; the raw value is still used for the id derivation. */
const MAX_STORED_EXPIRY_S = 32_503_680_000
const MAX_FEE_PPK = 1_000_000
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]+$/
const UNIT_RE = /^[A-Za-z0-9_-]{1,16}$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export interface ParsedKeyset {
  id: string
  unit: string
  active: boolean
  inputFeePpk: number | null
  /** Unix seconds as served (> 0), or null. */
  finalExpiry: number | null
  idVersion: KeysetIdVersion
}

export interface ParsedKeysets {
  keysets: ParsedKeyset[]
  /** Entries dropped because they were malformed or duplicated. */
  skipped: number
  /** Entries beyond KEYSETS_MAX_PER_MINT. */
  ignored: number
}

/** The validated keysets of a GET /v1/keysets body, or null when the body is a schema surprise (nothing usable). */
export function parseKeysetsResponse(raw: unknown): ParsedKeysets | null {
  if (!isObj(raw) || !Array.isArray(raw['keysets'])) return null
  const list = raw['keysets'] as unknown[]
  const keysets: ParsedKeyset[] = []
  const seen = new Set<string>()
  let skipped = 0
  let ignored = 0
  for (const entry of list) {
    if (keysets.length >= KEYSETS_MAX_PER_MINT) { ignored++; continue }
    if (!isObj(entry)) { skipped++; continue }
    const id = entry['id']
    const unit = entry['unit']
    const active = entry['active']
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LEN || !PRINTABLE_ASCII_RE.test(id)) { skipped++; continue }
    if (typeof unit !== 'string' || !UNIT_RE.test(unit) || typeof active !== 'boolean') { skipped++; continue }
    if (seen.has(id)) { skipped++; continue }
    seen.add(id)
    const fee = entry['input_fee_ppk']
    const expiry = entry['final_expiry']
    keysets.push({
      id,
      unit: unit.toLowerCase(),
      active,
      inputFeePpk: typeof fee === 'number' && Number.isSafeInteger(fee) && fee >= 0 && fee <= MAX_FEE_PPK ? fee : null,
      finalExpiry: typeof expiry === 'number' && Number.isSafeInteger(expiry) && expiry > 0 ? expiry : null,
      idVersion: classifyKeysetId(id),
    })
  }
  if (keysets.length === 0) return null
  return { keysets, skipped, ignored }
}

/** The amount -> public key map of keyset `id` from a GET /v1/keys/{id} body, or null when it is missing or malformed. */
export function parseKeysResponse(raw: unknown, id: string): KeysetKeys | null {
  if (!isObj(raw) || !Array.isArray(raw['keysets'])) return null
  const entry = (raw['keysets'] as unknown[]).find(e => isObj(e) && e['id'] === id)
  if (!isObj(entry) || !isObj(entry['keys'])) return null
  const keys = entry['keys']
  const amounts = Object.keys(keys)
  if (amounts.length === 0 || amounts.length > MAX_KEYS_PER_KEYSET) return null
  const out: Record<string, string> = {}
  for (const amount of amounts) {
    const key = keys[amount]
    if (typeof key !== 'string') return null
    out[amount] = key
  }
  return out
}

/** The hour slot (0..KEYSETS_SLOTS_PER_HOUR-1) a mint is visited in: stable per URL. */
export function keysetsSlotOf(url: string): number {
  return createHash('sha256').update(url).digest().readUInt32BE(0) % KEYSETS_SLOTS_PER_HOUR
}

/** The slot a cron tick at this minute of the hour serves (ticks run once per 5-minute block). */
export function keysetsSlotAt(minuteOfHour: number): number {
  return Math.floor(minuteOfHour / 5) % KEYSETS_SLOTS_PER_HOUR
}

export interface KeysetsDeps {
  /** GET and parse JSON; null on ANY failure (network, status, size, invalid JSON). Never throws. */
  fetchJson: (url: string, capBytes: number) => Promise<unknown | null>
  /** Upserts the rows of one mint in one statement and stamps mints.keysets_checked_at. */
  store: (url: string, rows: StoredKeyset[]) => Promise<void>
  /** "url\nkeyset id" of verdicts that disagreed once and wait for the confirming check. */
  pendingMismatch: Set<string>
  /** Mint change log: called with a complete, stored answer (never on a failure). Must not throw. */
  onObserved?: (url: string, parsed: ParsedKeysets) => Promise<void>
}

export interface StoredKeyset extends ParsedKeyset {
  /** true/false = both id and keys were obtained in this check; null = not checked now (the stored verdict stays). */
  idValid: boolean | null
}

export interface MintKeysetsResult {
  ok: boolean
  requests: number
  keysets: number
  verified: number
  legacy: number
  invalid: number
  skipped: number
  ignored: number
}

const EMPTY: MintKeysetsResult = { ok: false, requests: 0, keysets: 0, verified: 0, legacy: 0, invalid: 0, skipped: 0, ignored: 0 }

/** One mint: at most 1 + (number of active v1/v2 keysets) requests. Never throws. */
export async function collectMintKeysets(url: string, deps: KeysetsDeps): Promise<MintKeysetsResult> {
  let requests = 1
  const listRaw = await deps.fetchJson(`${url}/v1/keysets`, RESPONSE_CAPS.mintKeysets)
  const parsed = listRaw === null ? null : parseKeysetsResponse(listRaw)
  if (parsed === null) return { ...EMPTY, requests }

  const rows: StoredKeyset[] = []
  let verified = 0
  let legacy = 0
  let invalid = 0
  for (const ks of parsed.keysets) {
    let idValid: boolean | null = null
    if (ks.idVersion === 'legacy') legacy++
    if (ks.active && (ks.idVersion === 'v1' || ks.idVersion === 'v2')) {
      requests++
      const keysRaw = await deps.fetchJson(`${url}/v1/keys/${encodeURIComponent(ks.id)}`, RESPONSE_CAPS.mintKeys)
      const keys = keysRaw === null ? null : parseKeysResponse(keysRaw, ks.id)
      const verdict = keys === null ? null : verifyKeysetId(ks.id, keys, ks.unit, ks.inputFeePpk, ks.finalExpiry)
      const pendingKey = `${url}\n${ks.id}`
      if (verdict === false) {
        if (deps.pendingMismatch.has(pendingKey)) { idValid = false; invalid++ } else deps.pendingMismatch.add(pendingKey)
      } else {
        deps.pendingMismatch.delete(pendingKey)
        idValid = verdict
        if (verdict === true) verified++
      }
    }
    rows.push({ ...ks, idValid })
  }

  try {
    await deps.store(url, rows)
  } catch {
    return { ...EMPTY, requests }
  }
  await deps.onObserved?.(url, parsed)
  return { ok: true, requests, keysets: rows.length, verified, legacy, invalid, skipped: parsed.skipped, ignored: parsed.ignored }
}

// ── Defaults (network, database) ────────────────────────────────────────────

async function defaultFetchJson(url: string, capBytes: number): Promise<unknown | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: KEYSETS_FETCH_TIMEOUT_MS, headers: { Accept: 'application/json' } })
    if (!res || !res.ok) return null
    return await readJsonLimited(res, capBytes)
  } catch {
    return null // oversize, invalid JSON, aborted body
  }
}

// One statement, so a mint's rows are replaced atomically. A new id_valid of NULL keeps the stored one (the same id
// always has the same content, so an earlier verdict stays true when this check could not repeat it).
export const UPSERT_KEYSETS_SQL = `INSERT INTO mint_keysets
       (url, keyset_id, unit, active, input_fee_ppk, final_expiry, id_version, id_valid, first_seen_at, last_seen_at, last_checked_at)
     SELECT $1, t.keyset_id, t.unit, t.active, t.input_fee_ppk,
            CASE WHEN t.final_expiry IS NULL THEN NULL ELSE to_timestamp(t.final_expiry) END,
            t.id_version, t.id_valid, NOW(), NOW(), NOW()
       FROM unnest($2::text[], $3::text[], $4::boolean[], $5::integer[], $6::bigint[], $7::text[], $8::boolean[])
            AS t(keyset_id, unit, active, input_fee_ppk, final_expiry, id_version, id_valid)
     ON CONFLICT (url, keyset_id) DO UPDATE SET
       unit = EXCLUDED.unit,
       active = EXCLUDED.active,
       input_fee_ppk = EXCLUDED.input_fee_ppk,
       final_expiry = EXCLUDED.final_expiry,
       id_version = EXCLUDED.id_version,
       id_valid = COALESCE(EXCLUDED.id_valid, mint_keysets.id_valid),
       last_seen_at = NOW(),
       last_checked_at = NOW()`

async function defaultStore(url: string, rows: StoredKeyset[]): Promise<void> {
  await pool.query(UPSERT_KEYSETS_SQL, [
    url,
    rows.map(r => r.id),
    rows.map(r => r.unit),
    rows.map(r => r.active),
    rows.map(r => r.inputFeePpk),
    rows.map(r => (r.finalExpiry !== null && r.finalExpiry <= MAX_STORED_EXPIRY_S ? r.finalExpiry : null)),
    rows.map(r => r.idVersion),
    rows.map(r => r.idValid),
  ])
  await pool.query('UPDATE mints SET keysets_checked_at = NOW() WHERE url = $1', [url])
}

async function defaultListOnlineUrls(): Promise<string[]> {
  const res = await pool.query(
    `SELECT url FROM (
       SELECT DISTINCT ON (url) url, online
         FROM mint_history
        WHERE checked_at > NOW() - INTERVAL '${ONLINE_WINDOW_MINUTES} minutes'
        ORDER BY url, checked_at DESC
     ) latest
     WHERE online
     ORDER BY url`,
  )
  return (res.rows as Array<{ url: string }>).map(r => r.url)
}

// ── The tick ────────────────────────────────────────────────────────────────

export interface KeysetsTickOptions {
  deps?: KeysetsDeps
  now?: () => Date
  random?: () => number
  sleep?: (ms: number) => Promise<void>
  listOnlineUrls?: () => Promise<string[]>
  /** ISO time of the last suspected vantage outage (probeCycle.getLastVantageOutageAt), or null. */
  lastVantageOutageAt?: () => string | null
  log?: (line: string) => void
}

export interface KeysetsTickStats {
  skipped: 'vantage-outage' | 'running' | null
  slot: number
  mints: number
  ok: number
  failed: number
  requests: number
  keysets: number
  verified: number
  legacy: number
  invalid: number
  ignored: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
const sharedPending = new Set<string>()
let running = false

/** One cron tick: the online mints of the current slot, one at a time. Never throws; logs one counts-only line. */
export async function runKeysetsTick(opts: KeysetsTickOptions = {}): Promise<KeysetsTickStats> {
  const now = opts.now ?? (() => new Date())
  const random = opts.random ?? Math.random
  const sleep = opts.sleep ?? defaultSleep
  const log = opts.log ?? ((line: string) => console.log(line))
  const deps = opts.deps ?? { fetchJson: defaultFetchJson, store: defaultStore, pendingMismatch: sharedPending, onObserved: recordKeysetsObservation }
  const slot = keysetsSlotAt(now().getMinutes())
  const stats: KeysetsTickStats = {
    skipped: null, slot, mints: 0, ok: 0, failed: 0, requests: 0, keysets: 0, verified: 0, legacy: 0, invalid: 0, ignored: 0,
  }

  const outageAt = (opts.lastVantageOutageAt ?? (() => null))()
  if (outageAt !== null) {
    const age = now().getTime() - Date.parse(outageAt)
    if (Number.isFinite(age) && age >= 0 && age <= KEYSETS_VANTAGE_SKIP_MS) {
      log(`[keysets] slot ${slot}: skipped (suspected vantage outage)`)
      return { ...stats, skipped: 'vantage-outage' }
    }
  }
  if (running) {
    log(`[keysets] slot ${slot}: skipped (previous tick still running)`)
    return { ...stats, skipped: 'running' }
  }

  running = true
  try {
    const urls = (await (opts.listOnlineUrls ?? defaultListOnlineUrls)()).filter(u => keysetsSlotOf(u) === slot)
    stats.mints = urls.length
    if (urls.length > 0) await sleep(Math.floor(random() * KEYSETS_TICK_JITTER_MAX_MS))
    for (let i = 0; i < urls.length; i++) {
      if (i > 0) await sleep(KEYSETS_MINT_PAUSE_MS)
      const r = await collectMintKeysets(urls[i]!, deps)
      stats.requests += r.requests
      if (r.ok) {
        stats.ok++
        stats.keysets += r.keysets
        stats.verified += r.verified
        stats.legacy += r.legacy
        stats.invalid += r.invalid
        stats.ignored += r.ignored
      } else {
        stats.failed++
      }
    }
  } catch {
    // The list query failed: nothing was fetched or written; the next tick tries again.
    stats.failed++
  } finally {
    running = false
  }
  log(
    `[keysets] slot ${slot}: mints ${stats.mints}, ok ${stats.ok}, failed ${stats.failed}, requests ${stats.requests}, ` +
    `keysets ${stats.keysets}, verified ${stats.verified}, legacy ${stats.legacy}, invalid ${stats.invalid}, ignored ${stats.ignored}`,
  )
  return stats
}
