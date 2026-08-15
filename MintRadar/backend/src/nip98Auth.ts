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

const IS_DEV = process.env['NODE_ENV'] !== 'production'

// Reconstructs the absolute URL the client must have signed into its NIP-98
// event's `u` tag.
//
// GOTCHA: nginx's `location /api/` block (deploy/nginx.conf) does NOT set
// X-Forwarded-Proto — only Host, X-Real-IP, X-Forwarded-For. `trust proxy`
// (index.ts) makes Express fall back to the *actual* connection scheme when
// that header is absent, which between nginx and this process is always
// plain HTTP, even for requests the public client made over HTTPS. Trusting
// req.protocol here would make every production NIP-98 token fail url-tag
// validation (client signs https://…, server checks against http://…) —
// confirmed against the live server, see notification-subscribe deploy
// verification. So: honor X-Forwarded-Proto if a proxy ever does set it,
// otherwise assume the scheme this service is actually reachable on
// (https in production, http for local dev) — the same default-scheme
// convention DEFAULT_ORIGINS already uses in index.ts.
function getRequestUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto']
  const proto = typeof forwardedProto === 'string' && forwardedProto.length > 0
    ? forwardedProto.split(',')[0]!.trim()
    : (IS_DEV ? 'http' : 'https')
  return `${proto}://${req.get('host') ?? ''}${req.originalUrl}`
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
