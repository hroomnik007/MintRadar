import { pool } from './db.js'

// A Cashu mint's identity pubkey (NUT-06 `/v1/info.pubkey`) is a 33-byte
// compressed secp256k1 public key: a 02/03 parity-byte prefix + 32-byte X
// coordinate, hex-encoded — 66 lowercase hex chars total.
const COMPRESSED_SECP256K1_HEX_RE = /^0[23][0-9a-f]{64}$/

// Trims + lowercases + validates the shape. Anything that isn't a valid
// compressed secp256k1 hex pubkey normalizes to null (never throws) — a
// malformed/missing pubkey must not fail the probe it was read from.
export function normalizeMintPubkey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase()
  if (!COMPRESSED_SECP256K1_HEX_RE.test(trimmed)) return null
  return trimmed
}

// Rows sharing `pubkey` with an already-tracked mint, excluding the URL being
// submitted/probed itself. This is a lookup only — it never merges or alters
// another mint's row. Empty/invalid pubkey → [].
export async function findMintsByPubkey(
  pubkey: string | null,
  excludeUrl: string,
): Promise<{ url: string; name: string | null }[]> {
  const normalized = normalizeMintPubkey(pubkey)
  if (normalized === null) return []
  const res = await pool.query(
    `SELECT url, name FROM mints WHERE pubkey = $1 AND url <> $2`,
    [normalized, excludeUrl],
  )
  return res.rows.map(r => ({ url: r.url as string, name: (r.name as string | null) ?? null }))
}

// Used by paths (submit/discover) that only do a single fetch outside the
// main 5-min probe's own combined UPDATE — writes `pubkey`, keeping the
// prior stored value when the new info has none (never wipes a good key on
// a probe that omitted it), and logs once when a *stored* key actually
// changes (not on the initial write).
export async function persistMintPubkeyIfChanged(url: string, rawPubkey: unknown): Promise<void> {
  const normalized = normalizeMintPubkey(rawPubkey)
  if (normalized === null) return
  const storedRes = await pool.query('SELECT pubkey FROM mints WHERE url = $1', [url])
  const stored = (storedRes.rows[0]?.pubkey as string | null) ?? null
  if (stored !== null && stored !== normalized) {
    console.log(`[probe] pubkey changed for ${url}`)
  }
  if (stored !== normalized) {
    await pool.query('UPDATE mints SET pubkey = $1 WHERE url = $2', [normalized, url])
  }
}
