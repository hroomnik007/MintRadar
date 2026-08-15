import type { Request } from 'express'
import { nip98 } from 'nostr-tools'

export interface Nip98AuthOk {
  ok: true
  pubkey: string
}

export interface Nip98AuthFail {
  ok: false
  status: number
  error: string
}

export type Nip98AuthResult = Nip98AuthOk | Nip98AuthFail

// Reconstructs the absolute URL the client must have signed into its NIP-98
// event's `u` tag. `trust proxy` is enabled in index.ts, so req.protocol
// reflects X-Forwarded-Proto from nginx rather than the raw (http) socket.
function getRequestUrl(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? ''}${req.originalUrl}`
}

// Verifies the NIP-98 "Authorization: Nostr <base64-event>" header via
// nostr-tools' own validateToken (signature, kind, timestamp window, url and
// method tags) — never hand-rolled. Returns the authenticated pubkey on
// success, or a 401 with a generic reason on any failure.
export async function authenticateNip98(req: Request): Promise<Nip98AuthResult> {
  const header = req.headers['authorization']

  if (typeof header !== 'string' || header.length === 0) {
    return { ok: false, status: 401, error: 'Missing Authorization header' }
  }

  const url = getRequestUrl(req)

  try {
    const valid = await nip98.validateToken(header, url, req.method)
    if (!valid) {
      return { ok: false, status: 401, error: 'Invalid NIP-98 authorization' }
    }
    const event = await nip98.unpackEventFromToken(header)
    if (typeof event.pubkey !== 'string' || event.pubkey.length !== 64) {
      return { ok: false, status: 401, error: 'Invalid NIP-98 authorization' }
    }
    return { ok: true, pubkey: event.pubkey }
  } catch {
    // validateToken/unpackEventFromToken throw on any invalid case (missing
    // token, bad signature, wrong kind, expired timestamp, url/method
    // mismatch) — all collapse to a generic 401, no internal detail leaked.
    return { ok: false, status: 401, error: 'Invalid NIP-98 authorization' }
  }
}
