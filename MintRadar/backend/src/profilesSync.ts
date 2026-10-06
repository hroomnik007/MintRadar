// Server-side public profiles (kind:0) of review authors, fetched from a profile indexer and shown in the
// review list as a FALLBACK for reviewers whose profile the visitor's browser could not find.
//
// Runs at the end of each hourly reviews sync run (reviewsSync.ts refreshAllMintReviews), inside its
// single-flight and its maximum run duration. Relays are two hardcoded constants (never a relay taken from
// event data, so there is no SSRF surface and no DNS pinning is needed, same as the reviews sync).
//
// Only name, display_name and nip05 are stored, as cleaned text. picture, about, banner, website and every
// other field are never read into the database. All of it is untrusted text: it is never used for the
// rating, the operator rule or any score.

import { verifyEvent, nip19, type Event as NostrEvent } from 'nostr-tools'
import { pool } from './db.js'
import { isValidNip05Domain, isValidNip05Name } from './nip05Verify.js'
import {
  REVIEW_CONNECT_TIMEOUT_MS,
  REVIEW_MAX_CONSECUTIVE_FAILURES,
  REVIEW_PACING_MAX_MS,
  REVIEW_PACING_MIN_MS,
  REVIEW_QUERY_TIMEOUT_MS,
  chunk,
  connectRelayWs,
  type ConnectRelay,
} from './reviewsRelayFetch.js'

export const PROFILE_PRIMARY_RELAY = 'wss://profiles.nostr1.com'
export const PROFILE_FALLBACK_RELAY = 'wss://relay.nos.social'

/** Authors selected per run. */
export const PROFILE_MAX_AUTHORS_PER_RUN = 200
/** Authors per REQ. */
export const PROFILE_BATCH_SIZE = 50
/** REQs per run over both relays. */
export const PROFILE_MAX_REQS_PER_RUN = 8
/** A found profile is asked again after this long. */
export const PROFILE_FOUND_TTL_S = 7 * 24 * 60 * 60
/** An author nobody had a profile for is not asked again for this long. */
export const PROFILE_NOT_FOUND_TTL_S = 24 * 60 * 60
/** Rows of authors that are no longer review authors or mint keys are deleted after this long. */
export const PROFILE_RETENTION_S = 30 * 24 * 60 * 60

const MAX_CONTENT_BYTES = 8 * 1024
const MAX_NAME_GRAPHEMES = 48
const MAX_NIP05_CHARS = 100
const HEX64 = /^[0-9a-f]{64}$/
// Mint contact lists are written by the mint: same bounds as shared/operatorPubkeys.ts.
const MAX_CONTACTS = 3
const MAX_CONTACT_INFO_CHARS = 300

// ── Cleaning and parsing (pure) ───────────────────────────────────────────────────────────

// Control characters, zero-width characters (ZWSP, ZWNJ, ZWJ, word joiner, BOM, Mongolian vowel separator)
// and bidirectional controls (LRM, RLM, ALM, embeddings/overrides, isolates).
const INVISIBLE = new RegExp('[\\p{Cc}\\u200B-\\u200D\\u2060\\uFEFF\\u180E\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]', 'gu')
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** NFC, invisible and control characters removed, whitespace collapsed, trimmed. Null if not a string or empty. */
export function cleanProfileText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(LONE_SURROGATE, '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return text.length === 0 ? null : text
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

function capGraphemes(text: string, max: number): string {
  const out: string[] = []
  for (const { segment } of segmenter.segment(text)) {
    if (out.length >= max) break
    out.push(segment)
  }
  return out.join('')
}

export function cleanProfileName(value: unknown): string | null {
  const t = cleanProfileText(value)
  return t === null ? null : capGraphemes(t, MAX_NAME_GRAPHEMES)
}

/**
 * `name@domain` or `domain`, at most 100 characters. A longer value is dropped, not cut: a truncated
 * identifier would be a different identifier. Anything else is dropped too.
 */
export function cleanProfileNip05(value: unknown): string | null {
  const t = cleanProfileText(value)
  if (t === null || t.length > MAX_NIP05_CHARS) return null
  const at = t.indexOf('@')
  if (at === -1) return isValidNip05Domain(t) ? t : null
  const name = t.slice(0, at)
  const domain = t.slice(at + 1)
  return isValidNip05Name(name) && isValidNip05Domain(domain) ? t : null
}

export interface ParsedProfile {
  name: string | null
  displayName: string | null
  nip05: string | null
}

/** Content must be shorter than 8 KB and a JSON object; only the three fields are read. Null = unusable event. */
export function parseProfileContent(content: unknown): ParsedProfile | null {
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') >= MAX_CONTENT_BYTES) return null
  let meta: unknown
  try { meta = JSON.parse(content) } catch { return null }
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const o = meta as Record<string, unknown>
  return { name: cleanProfileName(o['name']), displayName: cleanProfileName(o['display_name']), nip05: cleanProfileNip05(o['nip05']) }
}

/** Per author the event with the highest created_at; only kind 0 events of requested authors with a valid signature. */
export function pickNewestProfileEvents(
  events: readonly NostrEvent[],
  requested: ReadonlySet<string>,
  into: Map<string, NostrEvent> = new Map(),
): Map<string, NostrEvent> {
  for (const e of events) {
    if (e.kind !== 0 || !requested.has(e.pubkey)) continue
    const best = into.get(e.pubkey)
    if (best && best.created_at >= e.created_at) continue
    let ok: boolean
    try { ok = verifyEvent(e) } catch { ok = false }
    if (ok) into.set(e.pubkey, e)
  }
  return into
}

// ── Selection (pure) ──────────────────────────────────────────────────────────────────────

export interface StoredProfileState {
  fetchedAt: number
  found: boolean
}

/**
 * Candidates with no row first (by key, for a stable order), then rows that are due: found ones older than
 * 7 days and not-found ones older than 24 hours, the oldest first. Fresh rows are skipped. At most `cap`.
 */
export function selectAuthorsToFetch(
  candidates: Iterable<string>,
  rows: ReadonlyMap<string, StoredProfileState>,
  nowSec: number,
  cap: number = PROFILE_MAX_AUTHORS_PER_RUN,
): string[] {
  const missing: string[] = []
  const due: Array<{ pubkey: string; fetchedAt: number }> = []
  for (const pubkey of candidates) {
    if (!HEX64.test(pubkey)) continue
    const row = rows.get(pubkey)
    if (!row) { missing.push(pubkey); continue }
    const ttl = row.found ? PROFILE_FOUND_TTL_S : PROFILE_NOT_FOUND_TTL_S
    if (nowSec - row.fetchedAt >= ttl) due.push({ pubkey, fetchedAt: row.fetchedAt })
  }
  missing.sort()
  due.sort((a, b) => a.fetchedAt - b.fetchedAt || (a.pubkey < b.pubkey ? -1 : 1))
  return [...missing, ...due.map(d => d.pubkey)].slice(0, cap)
}

/** Hex pubkeys from a mint's raw NUT-06 `nostr` contact strings (npub, nprofile or hex; at most 3 entries). */
export function contactKeysOf(contactNostr: unknown): string[] {
  if (!Array.isArray(contactNostr)) return []
  const out: string[] = []
  for (const raw of contactNostr.slice(0, MAX_CONTACTS)) {
    if (typeof raw !== 'string') continue
    const s = raw.trim().replace(/^nostr:/i, '')
    if (s.length === 0 || s.length > MAX_CONTACT_INFO_CHARS) continue
    if (HEX64.test(s.toLowerCase())) { out.push(s.toLowerCase()); continue }
    try {
      const d = nip19.decode(s)
      if (d.type === 'npub') out.push(d.data.toLowerCase())
      else if (d.type === 'nprofile') out.push(d.data.pubkey.toLowerCase())
    } catch { /* not a key (NIP-05 address, free text) */ }
  }
  return out
}

// ── The run ───────────────────────────────────────────────────────────────────────────────

export interface FoundProfileRow extends ParsedProfile {
  pubkey: string
  eventCreatedAt: number
}

export interface ProfilesSyncDeps {
  primaryRelay: string
  fallbackRelay: string
  loadCandidates: () => Promise<Set<string>>
  loadRows: () => Promise<Map<string, StoredProfileState>>
  save: (found: FoundProfileRow[], notFound: string[], fetchedAtSec: number) => Promise<void>
  cleanup: (candidates: ReadonlySet<string>, olderThanSec: number) => Promise<number>
  connect: ConnectRelay
  now: () => number
  sleep: (ms: number) => Promise<void>
  random: () => number
  log: (line: string) => void
  /** Absolute time (ms, same clock as `now`) when the run must stop: the reviews sync's maximum run duration. */
  deadlineMs: number
  config?: Partial<{
    batchSize: number
    maxAuthors: number
    maxReqs: number
    pacingMinMs: number
    pacingMaxMs: number
    queryTimeoutMs: number
    connectTimeoutMs: number
    maxConsecutiveFailures: number
  }>
}

export interface ProfilesSyncSummary {
  selected: number
  found: number
  notFound: number
  reqs: number
  relaysFailed: number
  durationMs: number
}

interface RelayPass {
  /** Authors whose batch this relay answered with EOSE. */
  answered: Set<string>
  reqs: number
  failed: boolean
}

export async function runProfilesSync(deps: ProfilesSyncDeps): Promise<ProfilesSyncSummary> {
  const startedMs = deps.now()
  const cfg = deps.config ?? {}
  const batchSize = cfg.batchSize ?? PROFILE_BATCH_SIZE
  const maxReqs = cfg.maxReqs ?? PROFILE_MAX_REQS_PER_RUN
  const pacingMin = cfg.pacingMinMs ?? REVIEW_PACING_MIN_MS
  const pacingMax = cfg.pacingMaxMs ?? REVIEW_PACING_MAX_MS
  const queryTimeout = cfg.queryTimeoutMs ?? REVIEW_QUERY_TIMEOUT_MS
  const maxFailures = cfg.maxConsecutiveFailures ?? REVIEW_MAX_CONSECUTIVE_FAILURES
  let reqs = 0
  let relaysFailed = 0
  let foundCount = 0
  let notFoundCount = 0
  let selectedCount = 0

  const summary = (): ProfilesSyncSummary => {
    const durationMs = deps.now() - startedMs
    deps.log(
      `[profiles-sync] done: selected=${selectedCount} found=${foundCount} not_found=${notFoundCount} ` +
      `reqs=${reqs} relays_failed=${relaysFailed} duration=${(durationMs / 1000).toFixed(1)}s`,
    )
    return { selected: selectedCount, found: foundCount, notFound: notFoundCount, reqs, relaysFailed, durationMs }
  }

  try {
    const candidates = await deps.loadCandidates()
    const rows = await deps.loadRows()
    const nowSec = Math.floor(startedMs / 1000)
    const selected = selectAuthorsToFetch(candidates, rows, nowSec, cfg.maxAuthors ?? PROFILE_MAX_AUTHORS_PER_RUN)
    selectedCount = selected.length

    const requested = new Set(selected)
    const best = new Map<string, NostrEvent>()
    const answeredAny = new Set<string>()

    // One connection, one REQ in flight, a pause between batches, the reviews sync's back-off rules.
    const pass = async (relay: string, authors: string[]): Promise<RelayPass> => {
      const res: RelayPass = { answered: new Set(), reqs: 0, failed: false }
      if (authors.length === 0 || reqs >= maxReqs || deps.now() >= deps.deadlineMs) return res
      let conn
      try {
        conn = await deps.connect(relay, cfg.connectTimeoutMs ?? REVIEW_CONNECT_TIMEOUT_MS)
      } catch {
        res.failed = true
        return res
      }
      try {
        let consecutiveFailures = 0
        let first = true
        for (const batch of chunk(authors, batchSize)) {
          if (reqs >= maxReqs) break
          if (!first) await deps.sleep(pacingMin + deps.random() * (pacingMax - pacingMin))
          first = false
          const remaining = deps.deadlineMs - deps.now()
          if (remaining <= 0) break
          reqs++
          res.reqs++
          const answer = await conn.query({ kinds: [0], authors: batch, limit: batch.length * 4 }, Math.min(queryTimeout, remaining))
          if (answer.status === 'ok') {
            consecutiveFailures = 0
            pickNewestProfileEvents(answer.events, requested, best)
            for (const a of batch) res.answered.add(a)
          } else if (answer.status === 'blocked') {
            res.failed = true
            break
          } else {
            res.failed = true
            if (++consecutiveFailures >= maxFailures) break
          }
        }
      } finally {
        conn.close()
      }
      return res
    }

    if (selected.length > 0) {
      const primary = await pass(deps.primaryRelay, selected)
      if (primary.failed) relaysFailed++
      for (const a of primary.answered) answeredAny.add(a)

      const stillMissing = selected.filter(a => !best.has(a))
      const fallback = await pass(deps.fallbackRelay, stillMissing)
      if (fallback.failed) relaysFailed++
      for (const a of fallback.answered) answeredAny.add(a)

      const found: FoundProfileRow[] = []
      const notFound: string[] = []
      for (const pubkey of selected) {
        const event = best.get(pubkey)
        if (event) {
          const parsed = parseProfileContent(event.content)
          // Unusable content (oversized, not JSON): the author is answered but has nothing to show.
          found.push({ pubkey, eventCreatedAt: event.created_at, ...(parsed ?? { name: null, displayName: null, nip05: null }) })
        } else if (answeredAny.has(pubkey)) {
          notFound.push(pubkey) // asked and answered, nobody has it; authors no relay answered are left for the next run
        }
      }
      foundCount = found.length
      notFoundCount = notFound.length
      if (found.length > 0 || notFound.length > 0) await deps.save(found, notFound, nowSec)
    }

    try {
      await deps.cleanup(candidates, nowSec - PROFILE_RETENTION_S)
    } catch (err) {
      deps.log(`[profiles-sync] cleanup failed: ${err instanceof Error ? err.message : err}`)
    }
  } catch (err) {
    deps.log(`[profiles-sync] error: ${err instanceof Error ? err.message : err}`)
  }
  return summary()
}

// ── Database side ─────────────────────────────────────────────────────────────────────────

async function loadCandidates(): Promise<Set<string>> {
  const [reviewers, mints] = await Promise.all([
    pool.query('SELECT DISTINCT pubkey FROM mint_reviews'),
    pool.query('SELECT nostr_announce_pubkey, contact_nostr FROM mints'),
  ])
  const out = new Set<string>()
  for (const r of reviewers.rows as Array<{ pubkey: string }>) {
    const k = r.pubkey.toLowerCase()
    if (HEX64.test(k)) out.add(k)
  }
  for (const m of mints.rows as Array<{ nostr_announce_pubkey: string | null; contact_nostr: unknown }>) {
    if (typeof m.nostr_announce_pubkey === 'string' && HEX64.test(m.nostr_announce_pubkey.toLowerCase())) {
      out.add(m.nostr_announce_pubkey.toLowerCase())
    }
    for (const k of contactKeysOf(m.contact_nostr)) out.add(k)
  }
  return out
}

async function loadRows(): Promise<Map<string, StoredProfileState>> {
  const { rows } = await pool.query('SELECT pubkey, fetched_at, found FROM nostr_profiles')
  const out = new Map<string, StoredProfileState>()
  for (const r of rows as Array<{ pubkey: string; fetched_at: string | number; found: boolean }>) {
    out.set(r.pubkey, { fetchedAt: Number(r.fetched_at), found: r.found })
  }
  return out
}

async function saveProfiles(found: FoundProfileRow[], notFound: string[], fetchedAtSec: number): Promise<void> {
  if (found.length > 0) {
    // An older event than the stored one (a lagging relay) never replaces newer content; fetched_at still moves.
    await pool.query(
      `INSERT INTO nostr_profiles (pubkey, name, display_name, nip05, event_created_at, fetched_at, found)
       SELECT p, n, d, s, c, $6::bigint, true
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bigint[]) AS v(p, n, d, s, c)
       ON CONFLICT (pubkey) DO UPDATE SET
         name = CASE WHEN nostr_profiles.found AND nostr_profiles.event_created_at > EXCLUDED.event_created_at THEN nostr_profiles.name ELSE EXCLUDED.name END,
         display_name = CASE WHEN nostr_profiles.found AND nostr_profiles.event_created_at > EXCLUDED.event_created_at THEN nostr_profiles.display_name ELSE EXCLUDED.display_name END,
         nip05 = CASE WHEN nostr_profiles.found AND nostr_profiles.event_created_at > EXCLUDED.event_created_at THEN nostr_profiles.nip05 ELSE EXCLUDED.nip05 END,
         event_created_at = CASE WHEN nostr_profiles.found AND nostr_profiles.event_created_at > EXCLUDED.event_created_at THEN nostr_profiles.event_created_at ELSE EXCLUDED.event_created_at END,
         fetched_at = EXCLUDED.fetched_at,
         found = true`,
      [
        found.map(f => f.pubkey), found.map(f => f.name), found.map(f => f.displayName),
        found.map(f => f.nip05), found.map(f => f.eventCreatedAt), fetchedAtSec,
      ],
    )
  }
  if (notFound.length > 0) {
    // A profile we already hold is kept when the indexers happen not to have it right now: only the check time moves.
    await pool.query(
      `INSERT INTO nostr_profiles (pubkey, fetched_at, found)
       SELECT p, $2::bigint, false FROM unnest($1::text[]) AS v(p)
       ON CONFLICT (pubkey) DO UPDATE SET fetched_at = EXCLUDED.fetched_at`,
      [notFound, fetchedAtSec],
    )
  }
}

async function cleanupProfiles(candidates: ReadonlySet<string>, olderThanSec: number): Promise<number> {
  const { rowCount } = await pool.query(
    'DELETE FROM nostr_profiles WHERE fetched_at < $1 AND pubkey <> ALL($2::text[])',
    [olderThanSec, [...candidates]],
  )
  return rowCount ?? 0
}

/** Called by refreshAllMintReviews() after the reviews run; never throws. `deadlineMs` = the sync's max run end. */
export function runProfilesSyncForServer(deadlineMs: number): Promise<ProfilesSyncSummary> {
  return runProfilesSync({
    primaryRelay: PROFILE_PRIMARY_RELAY,
    fallbackRelay: PROFILE_FALLBACK_RELAY,
    loadCandidates,
    loadRows,
    save: saveProfiles,
    cleanup: cleanupProfiles,
    connect: connectRelayWs,
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    random: Math.random,
    log: line => console.log(line),
    deadlineMs,
  })
}

/** What GET /api/mints/nostr-reviews adds per review: display_name or name, and the NIP-05 claim, only when found. */
export function profileFieldsForReview(row: { found?: boolean | null; name?: string | null; display_name?: string | null; nip05?: string | null }): { authorName?: string; authorNip05?: string } {
  if (row.found !== true) return {}
  const out: { authorName?: string; authorNip05?: string } = {}
  const name = row.display_name || row.name
  if (name) out.authorName = name
  if (row.nip05) out.authorNip05 = row.nip05
  return out
}
