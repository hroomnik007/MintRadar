// Pure helpers for assigning NIP-87 kind:38000 reviews to known mints.
// Matches the IMF addressing forms (u URL, legacy d=URL, d=mint pubkey, a=38172:announcer:id)
// without depending on IMF code. URL spelling uses discovery.normalizeUrl so trailing-slash /
// http→https / host case line up with stored mint URLs. Identifier keys are compared
// case-insensitively. Does not gate on `k` (MintRadar historically accepts reviews without it).

import { normalizeUrl } from './discovery.js'

export interface MintReviewIdentity {
  url: string
  /** NUT-06 /v1/info pubkey (typically 66-hex compressed), when known. */
  pubkey?: string | null
  /** Author of the mint's stored kind:38172 announcement. */
  announcePubkey?: string | null
  /** `d` tag of that announcement (mint pubkey or legacy URL). */
  announceD?: string | null
}

export interface MintReviewIndex {
  /** Stored mint URLs (exact DB strings). */
  urls: ReadonlySet<string>
  /** Lowercased identifier → stored mint URL (pubkey, announce d, full a-address). */
  byId: ReadonlyMap<string, string>
}

const HEX64 = /^[0-9a-f]{64}$/i
const MINT_PUBKEY = /^0[23][0-9a-f]{64}$/i

/** True for a NUT-06 compressed mint pubkey or a 64-hex (x-only / Nostr) key. */
export function isReviewMintPubkey(value: string): boolean {
  const s = value.trim()
  return (s.length === 64 && HEX64.test(s)) || (s.length === 66 && MINT_PUBKEY.test(s))
}

/**
 * Safe mint-URL candidate for review tags. Rejects non-http(s), userinfo, query, fragment
 * (same shape IMF keeps out of targets). Returns MintRadar's normalizeUrl form so it can
 * equal a stored mint URL.
 */
export function reviewUrlCandidate(raw: string): string | null {
  const t = raw.trim()
  if (t.length === 0 || t.length > 2048) return null
  if (!/^https?:\/\//i.test(t)) return null
  try {
    const u = new URL(t)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    if (u.username !== '' || u.password !== '') return null
    if (u.search !== '' || u.hash !== '') return null
    return normalizeUrl(t)
  } catch {
    return null
  }
}

function addId(map: Map<string, string>, key: string, url: string): void {
  const k = key.trim()
  if (!k || k.length > 2048) return
  map.set(k.toLowerCase(), url)
}

export function buildMintReviewIndex(mints: readonly MintReviewIdentity[]): MintReviewIndex {
  const urls = new Set<string>()
  const byId = new Map<string, string>()
  for (const m of mints) {
    const url = m.url.trim()
    if (!url) continue
    urls.add(url)
    // Exact stored spelling is what covered/persist use; also index normalize form if different.
    const norm = reviewUrlCandidate(url)
    if (norm && norm !== url) {
      // Prefer resolving normalized tag spellings back to the stored URL via byId? No — urls.has(norm)
      // would miss. Keep only stored URLs in `urls`; map normalized → stored when they differ.
      byId.set(`url:${norm}`, url)
    }
    if (m.pubkey) addId(byId, m.pubkey, url)
    if (m.announceD) {
      addId(byId, m.announceD, url)
      const asUrl = reviewUrlCandidate(m.announceD)
      if (asUrl) byId.set(`url:${asUrl}`, url)
    }
    const ap = typeof m.announcePubkey === 'string' ? m.announcePubkey.trim() : ''
    const ad = typeof m.announceD === 'string' ? m.announceD.trim() : ''
    if (ap && ad && HEX64.test(ap)) {
      addId(byId, `38172:${ap}:${ad}`, url)
    }
  }
  return { urls, byId }
}

function resolveUrl(index: MintReviewIndex, candidate: string): string | null {
  if (index.urls.has(candidate)) return candidate
  return index.byId.get(`url:${candidate}`) ?? null
}

function resolveId(index: MintReviewIndex, id: string): string | null {
  return index.byId.get(id.trim().toLowerCase()) ?? null
}

/**
 * Stored mint URLs this review event targets, via u / d / a tags (IMF-compatible).
 * An event naming several tracked mints belongs to each of them.
 */
export function mintUrlsForReviewEvent(
  tags: readonly (readonly string[])[],
  index: MintReviewIndex,
): Set<string> {
  const owners = new Set<string>()
  let dTag: string | undefined
  for (const t of tags) {
    const name = t[0]
    const value = t[1]
    if (value === undefined) continue
    if (name === 'u') {
      // Typed URLs from early clients may mix Cashu and Fedimint recommendations.
      if (t[2] === 'fedimint') continue
      const cand = reviewUrlCandidate(value)
      if (cand) {
        const url = resolveUrl(index, cand)
        if (url) owners.add(url)
      }
      continue
    }
    if (name === 'd' && dTag === undefined) dTag = value
    if (name === 'a') {
      const parts = value.split(':')
      if (parts.length < 3 || parts[0] !== '38172') continue
      const announcer = parts[1] ?? ''
      const id = parts.slice(2).join(':')
      if (!announcer || !id || id.length > 2048) continue
      if (!HEX64.test(announcer)) continue
      const byAddr = resolveId(index, `38172:${announcer}:${id}`)
      if (byAddr) owners.add(byAddr)
      const idUrl = reviewUrlCandidate(id)
      if (idUrl) {
        const url = resolveUrl(index, idUrl)
        if (url) owners.add(url)
      } else if (isReviewMintPubkey(id)) {
        const byKey = resolveId(index, id)
        if (byKey) owners.add(byKey)
      }
    }
  }
  if (dTag !== undefined && dTag !== '') {
    const asUrl = reviewUrlCandidate(dTag)
    if (asUrl) {
      const url = resolveUrl(index, asUrl)
      if (url) owners.add(url)
    } else if (isReviewMintPubkey(dTag) || dTag.length <= 2048) {
      // Legacy / current: d=mint pubkey (or other identifier IMF indexes). Only accept
      // pubkey-shaped or already-indexed identifiers — never arbitrary free text.
      const byKey = resolveId(index, dTag)
      if (byKey) owners.add(byKey)
    }
  }
  return owners
}

/** NIP-01 replaceable preference: higher created_at wins; equal → lower hex event id. */
export function isPreferredReplaceable(
  candidate: { id: string; created_at: number },
  current: { id: string; created_at: number },
): boolean {
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at
  return candidate.id.toLowerCase() < current.id.toLowerCase()
}

/** Build the OR filters for one mint batch: #u, #d (urls + ids), optional #a. */
export function reviewFiltersForMintBatch(
  mints: readonly MintReviewIdentity[],
  limit: number,
  since: number | undefined,
): Array<{ kinds: number[]; '#u'?: string[]; '#d'?: string[]; '#a'?: string[]; limit: number; since?: number }> {
  const urls: string[] = []
  const dVals = new Set<string>()
  const aVals = new Set<string>()
  for (const m of mints) {
    const url = m.url.trim()
    if (!url) continue
    urls.push(url)
    dVals.add(url)
    if (m.pubkey && isReviewMintPubkey(m.pubkey)) dVals.add(m.pubkey.trim())
    if (m.announceD && m.announceD.trim()) dVals.add(m.announceD.trim())
    const ap = typeof m.announcePubkey === 'string' ? m.announcePubkey.trim() : ''
    const ad = typeof m.announceD === 'string' ? m.announceD.trim() : ''
    if (ap && ad && HEX64.test(ap)) aVals.add(`38172:${ap}:${ad}`)
  }
  const base: { since?: number } = since !== undefined ? { since } : {}
  const filters: Array<{ kinds: number[]; '#u'?: string[]; '#d'?: string[]; '#a'?: string[]; limit: number; since?: number }> = [
    { kinds: [38000], '#u': urls, limit, ...base },
  ]
  if (dVals.size > 0) filters.push({ kinds: [38000], '#d': [...dVals], limit, ...base })
  if (aVals.size > 0) filters.push({ kinds: [38000], '#a': [...aVals], limit, ...base })
  return filters
}
