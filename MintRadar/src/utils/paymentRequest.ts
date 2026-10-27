// NUT-18 payment request ("creqA…") decoding for the Payment request inspector. Everything here is local: the string is
// decoded in the browser by cashu-ts (already a dependency) and never leaves it. The decoder's output is not trusted:
// every field is checked for its type and anything unexpected is either ignored (unknown extra fields) or makes the
// whole request invalid (a calm single message, no technical detail).
import { PaymentRequest } from '@cashu/cashu-ts'
import { mintStatus } from '@/utils/mintStatus'
import { mintStatusLabel, type StatusDotWord } from '@/utils/mintFormatting'

export const PAYMENT_REQUEST_PREFIX = 'creqA'
export const PAYMENT_REQUEST_MAX_LENGTH = 4096
export const PAYMENT_REQUEST_INVALID = 'This does not look like a valid payment request.'
export const PAYMENT_REQUEST_TOO_LONG = `This payment request is longer than ${PAYMENT_REQUEST_MAX_LENGTH.toLocaleString('en-US')} characters, which is more than this tool reads.`

export interface PaymentRequestTransportView {
  /** "nostr", "post", or the raw type text of any other transport. */
  type: string
  /** Shown as text only; never turned into a link. */
  target: string
}

export interface PaymentRequestLock {
  kind: string
  data: string
  tags: string[]
}

export interface PaymentRequestView {
  id: string | null
  /** Plain decimal string of the amount in the request's unit, or null when not specified. */
  amount: string | null
  unit: string | null
  singleUse: boolean | null
  description: string | null
  mints: string[]
  transports: PaymentRequestTransportView[]
  lock: PaymentRequestLock | null
}

export type PaymentRequestParse =
  | { ok: true; view: PaymentRequestView }
  | { ok: false; reason: 'empty' | 'prefix' | 'too-long' | 'invalid'; message: string }

const fail = (reason: 'prefix' | 'too-long' | 'invalid', message: string): PaymentRequestParse => ({ ok: false, reason, message })

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * With every field optional, the library turns ANY decodable CBOR value that is not a map (a string, a number, an array) into
 * an empty request. A payment request is a CBOR map, so the first byte must be of major type 5 (0xa0 to 0xbf).
 */
function payloadIsCborMap(payload: string): boolean {
  const head = payload.slice(0, 4).replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/')
  if (head.length < 2 || !/^[A-Za-z0-9+/]+$/.test(head)) return false
  try {
    const first = atob(head.padEnd(4, '=').slice(0, 4)).charCodeAt(0)
    return first >= 0xa0 && first <= 0xbf
  } catch {
    return false
  }
}

/** Trim, check the prefix and the length, decode, validate. Never throws. */
export function parsePaymentRequest(raw: string): PaymentRequestParse {
  const text = raw.trim()
  if (!text) return { ok: false, reason: 'empty', message: '' }
  if (!text.startsWith(PAYMENT_REQUEST_PREFIX)) return fail('prefix', 'Not a payment request: expected a string starting with creqA.')
  if (text.length > PAYMENT_REQUEST_MAX_LENGTH) return fail('too-long', PAYMENT_REQUEST_TOO_LONG)

  if (!payloadIsCborMap(text.slice(PAYMENT_REQUEST_PREFIX.length))) return fail('invalid', PAYMENT_REQUEST_INVALID)

  try {
    const req = PaymentRequest.fromEncodedRequest(text) as unknown as Record<string, unknown>
    if (typeof req !== 'object' || req === null) return fail('invalid', PAYMENT_REQUEST_INVALID)

    // Every field of NUT-18 is optional, so an absent `mints` (or an empty list) is a valid request with no accepted
    // mints; only a field that is present but of the wrong type makes the input unusable.
    const mintsRaw = req.mints
    if (mintsRaw !== undefined && mintsRaw !== null && (!Array.isArray(mintsRaw) || !mintsRaw.every(m => typeof m === 'string'))) {
      return fail('invalid', PAYMENT_REQUEST_INVALID)
    }
    const mints = ((mintsRaw ?? []) as string[]).filter(m => m.trim() !== '')

    let amount: string | null = null
    if (req.amount !== undefined && req.amount !== null) {
      const a = req.amount as { toBigInt?: () => bigint }
      amount = typeof a.toBigInt === 'function' ? a.toBigInt().toString() : null
      if (amount === null) return fail('invalid', PAYMENT_REQUEST_INVALID)
    }

    const transportsRaw = req.transport
    if (transportsRaw !== undefined && !Array.isArray(transportsRaw)) return fail('invalid', PAYMENT_REQUEST_INVALID)
    const transports: PaymentRequestTransportView[] = []
    for (const t of (transportsRaw ?? []) as unknown[]) {
      const o = t as Record<string, unknown> | null
      const type = o ? str(o.type) : null
      const target = o ? str(o.target) : null
      if (type === null || target === null) return fail('invalid', PAYMENT_REQUEST_INVALID)
      transports.push({ type, target })
    }

    let lock: PaymentRequestLock | null = null
    if (req.nut10 !== undefined && req.nut10 !== null) {
      const n = req.nut10 as Record<string, unknown>
      const kind = str(n.kind)
      const data = str(n.data)
      if (kind === null || data === null) return fail('invalid', PAYMENT_REQUEST_INVALID)
      const tags = Array.isArray(n.tags)
        ? n.tags.filter((t): t is unknown[] => Array.isArray(t)).map(t => t.filter((x): x is string => typeof x === 'string').join(': '))
        : []
      lock = { kind, data, tags }
    }

    return {
      ok: true,
      view: {
        id: str(req.id),
        amount,
        unit: str(req.unit),
        singleUse: typeof req.singleUse === 'boolean' ? (req.singleUse ? true : null) : null,
        description: str(req.description),
        mints,
        transports,
        lock,
      },
    }
  } catch {
    return fail('invalid', PAYMENT_REQUEST_INVALID)
  }
}

/** The site's status word (shared rule in utils/mintStatus.ts, the same as the wallet API `status`; 2026-10-27).
 *  Only a mint with no probe result and no flag is "Unknown" here. */
export function mintStatusWord(m: { online: boolean | null; degraded?: boolean; archived?: boolean }): StatusDotWord {
  if (m.online == null && m.degraded !== true && m.archived !== true) return 'Unknown'
  return mintStatusLabel(mintStatus(m))
}
