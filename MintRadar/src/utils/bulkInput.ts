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

export type BulkFailureKind = 'unreachable' | 'blocked' | 'invalid' | 'too-long' | 'error'

// Maps the server's per-row error strings to a class; the strings themselves are never shown.
export function classifyBulkError(error: string | undefined): BulkFailureKind {
  if (!error) return 'error'
  if (error.startsWith('URL does not appear to be a valid Cashu mint')) return 'unreachable'
  if (error === 'Invalid url') return 'blocked'
  if (error.startsWith('url must start with https')) return 'invalid'
  if (error.startsWith('url exceeds maximum length')) return 'too-long'
  return 'error'
}

export const BULK_FAILURE_LABEL: Record<BulkFailureKind, string> = {
  unreachable: 'Not a Cashu mint / unreachable',
  blocked: 'Blocked or unresolvable address',
  invalid: 'Invalid URL',
  'too-long': 'Too long',
  error: 'Error',
}
