// Cashu token decoding, backed by the official @cashu/cashu-ts library.
//
// getTokenMetadata() is the primary path: it decodes both v3 (cashuA…, base64
// JSON) and v4 (cashuB…, CBOR) purely locally — no network request, no keysets
// needed — which is exactly what the Token Inspector wants for a paste-and-look
// tool. The heavier full decode (proofs + DLEQ) lives in decodeTokenWithMint()
// below and needs the mint online.
import { getTokenMetadata, hasValidDleq, Wallet, type Proof } from '@cashu/cashu-ts'

export interface TokenInfo {
  mint: string
  amount: number
  unit: string
  /** Number of proofs in the token, or null when the encoding doesn't expose them. */
  proofsCount: number | null
  /** Human-readable encoding version, e.g. "v4 (cashuB)". */
  version: string
  memo: string | null
}

function tokenVersionLabel(token: string): string {
  if (token.startsWith('cashuB')) return 'v4 (cashuB)'
  if (token.startsWith('cashuA')) return 'v3 (cashuA)'
  return 'unknown'
}

export interface TokenParseResult {
  info: TokenInfo | null
  error: string | null
}

/**
 * Decode a Cashu token to its metadata. Never throws — an undecodable token
 * comes back as `{ info: null, error }` so the caller can render a message
 * instead of crashing.
 */
export function parseCashuToken(raw: string): TokenParseResult {
  const token = raw.trim()
  if (!token) return { info: null, error: 'Paste a Cashu token first.' }
  if (!token.startsWith('cashuA') && !token.startsWith('cashuB')) {
    return { info: null, error: 'Not a Cashu token — expected a string starting with cashuA (v3) or cashuB (v4).' }
  }

  try {
    const meta = getTokenMetadata(token)
    const amount = Number(meta.amount.toString())
    return {
      info: {
        mint: meta.mint,
        amount: Number.isFinite(amount) ? amount : 0,
        unit: meta.unit,
        proofsCount: meta.proofAmounts.length > 0 ? meta.proofAmounts.length : null,
        version: tokenVersionLabel(token),
        memo: meta.memo ?? null,
      },
      error: null,
    }
  } catch (err) {
    const detail = err instanceof Error && err.message ? ` (${err.message})` : ''
    return { info: null, error: `Could not decode this token — it looks malformed or truncated${detail}.` }
  }
}

export interface DecodedProof {
  proof: Proof
  /** null when the keyset for this proof couldn't be resolved from the mint. */
  dleqValid: boolean | null
}

export interface FullTokenDecode {
  info: TokenInfo
  proofs: DecodedProof[]
  /** True only when every proof carries a DLEQ proof that verifies. */
  allDleqValid: boolean
}

/**
 * Full decode: resolves the token's proofs against the live mint and verifies
 * each proof's NUT-12 DLEQ signature.
 *
 * Unlike parseCashuToken() this needs the mint to be reachable (Wallet.loadMint
 * fetches /v1/info + /v1/keysets + /v1/keys). Not wired into the UI yet — it is
 * the groundwork for showing DLEQ validity in the Token Inspector.
 *
 * @throws if the mint is unreachable or the token can't be resolved.
 */
export async function decodeTokenWithMint(raw: string): Promise<FullTokenDecode> {
  const token = raw.trim()
  const { info, error } = parseCashuToken(token)
  if (!info) throw new Error(error ?? 'Invalid token')

  const wallet = new Wallet(info.mint, { unit: info.unit })
  await wallet.loadMint()

  const decoded = wallet.decodeToken(token)
  const proofs: DecodedProof[] = decoded.proofs.map(proof => {
    let dleqValid: boolean | null
    try {
      // require:false — NUT-12 mandates "verify if present", so a proof with no
      // DLEQ payload is not itself a failure.
      dleqValid = hasValidDleq(proof, wallet.getKeyset(proof.id), { require: false })
    } catch {
      dleqValid = null
    }
    return { proof, dleqValid }
  })

  return {
    info: { ...info, proofsCount: proofs.length },
    proofs,
    allDleqValid: proofs.length > 0 && proofs.every(p => p.dleqValid === true),
  }
}
