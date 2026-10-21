// NUT-18 payment request ("creqA…") decoding for the Payment request inspector. Everything here is local: the string is
// decoded in the browser by cashu-ts (already a dependency) and never leaves it. The decoder's output is not trusted:
// every field is checked for its type and anything unexpected is either ignored (unknown extra fields) or makes the
// whole request invalid (a calm single message, no technical detail).
import { PaymentRequest } from '@cashu/cashu-ts'

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

/** Trim, check the prefix and the length, decode, validate. Never throws. */
export function parsePaymentRequest(raw: string): PaymentRequestParse {
  const text = raw.trim()
  if (!text) return { ok: false, reason: 'empty', message: '' }
  if (!text.startsWith(PAYMENT_REQUEST_PREFIX)) return fail('prefix', 'Not a payment request: expected a string starting with creqA.')
  if (text.length > PAYMENT_REQUEST_MAX_LENGTH) return fail('too-long', PAYMENT_REQUEST_TOO_LONG)

  try {
    const req = PaymentRequest.fromEncodedRequest(text) as unknown as Record<string, unknown>
    if (typeof req !== 'object' || req === null) return fail('invalid', PAYMENT_REQUEST_INVALID)

    const mintsRaw = req.mints
    if (!Array.isArray(mintsRaw) || mintsRaw.length === 0 || !mintsRaw.every(m => typeof m === 'string' && m.trim() !== '')) {
      return fail('invalid', PAYMENT_REQUEST_INVALID)
    }

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
        mints: mintsRaw as string[],
        transports,
        lock,
      },
    }
  } catch {
    return fail('invalid', PAYMENT_REQUEST_INVALID)
  }
}

/** Status words as the spec names them. A flag order that mirrors how the site treats the data: archived first. */
export function mintStatusWord(m: { online: boolean | null; degraded?: boolean; archived?: boolean }): 'Online' | 'Offline' | 'Degraded' | 'Archived' | 'Unknown' {
  if (m.archived === true) return 'Archived'
  if (m.degraded === true) return 'Degraded'
  if (m.online === true) return 'Online'
  if (m.online === false) return 'Offline'
  return 'Unknown'
}
