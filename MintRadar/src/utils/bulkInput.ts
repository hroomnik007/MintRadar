import { probeErrorMessage } from '@/utils/probeErrorMessages'
import { classifySubmitInput, normalizeMintUrl, type SubmitInputClass } from '@/utils/submitInput'

// Mirrors MAX_DISCOVER_BATCH in backend/src/index.ts (no shared code between the packages — keep in sync).
export const MAX_BULK_URLS = 100

export interface BulkIssue {
  line: number
  reason: string
  // The offending text for display; null when it must never be echoed (a private key).
  text: string | null
}
export interface BulkDuplicate { line: number; of: number }
export interface BulkParse {
  /** Normalised, de-duplicated https URLs in the order they appear. */
  valid: string[]
  invalid: BulkIssue[]
  duplicates: BulkDuplicate[]
}

function bulkReason(c: SubmitInputClass): string {
  switch (c.kind) {
    case 'nsec': return 'That looks like a private key. Remove it.'
    case 'npub':
    case 'invalid-npub':
    case 'hex':
    case 'nprofile': return 'Bulk accepts https:// mint URLs only.'
    case 'http': return 'The URL must start with https://.'
    case 'spaces': return 'Remove the spaces from the URL.'
    case 'too-long': return 'That URL is too long.'
    default: return 'Not an https:// URL.'
  }
}

export function parseBulkInput(text: string): BulkParse {
  const valid: string[] = []
  const invalid: BulkIssue[] = []
  const duplicates: BulkDuplicate[] = []
  const firstLineOf = new Map<string, number>()
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1
    const t = raw.trim()
    if (t === '') return
    const c = classifySubmitInput(t)
    if (c.kind === 'url') {
      const url = normalizeMintUrl(c.url)
      const first = firstLineOf.get(url)
      if (first !== undefined) { duplicates.push({ line, of: first }); return }
      firstLineOf.set(url, line)
      valid.push(url)
      return
    }
    invalid.push({ line, reason: bulkReason(c), text: c.kind === 'nsec' ? null : t.length > 48 ? `${t.slice(0, 47)}…` : t })
  })
  return { valid, invalid, duplicates }
}

export type BulkFailureKind = 'unreachable' | 'dns' | 'invalid' | 'too-long' | 'error'

// Fallback only, for a row without an errorKind (older backend / non-probe failure): the server's string picks a class.
// 'Invalid url' is the SSRF/DNS rejection — worded like a host name that cannot be found, never as its own status.
export function classifyBulkError(error: string | undefined): BulkFailureKind {
  if (!error) return 'error'
  if (error.startsWith('URL does not appear to be a valid Cashu mint')) return 'unreachable'
  if (error === 'Invalid url') return 'dns'
  if (error.startsWith('url must start with https')) return 'invalid'
  if (error.startsWith('url exceeds maximum length')) return 'too-long'
  return 'error'
}

const FALLBACK_TEXT: Record<Exclude<BulkFailureKind, 'dns'>, string> = {
  unreachable: 'Not a Cashu mint / unreachable',
  invalid: 'Invalid URL',
  'too-long': 'Too long',
  error: 'Error',
}

// The message for a failed row: the shared errorKind helper first (blocked_address is worded like dns), the
// server-string fallback only when no errorKind came back.
export function bulkFailureMessage(errorKind: unknown, error: string | undefined): string {
  const kind = errorKind === 'blocked_address' ? 'dns' : errorKind
  const fromKind = probeErrorMessage(kind)
  if (fromKind !== null) return fromKind
  const c = classifyBulkError(error)
  return c === 'dns' ? (probeErrorMessage('dns') ?? FALLBACK_TEXT.error) : FALLBACK_TEXT[c]
}
