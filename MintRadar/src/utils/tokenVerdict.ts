// Token inspector, the result block at the top. Pure, no React; the wording of every state lives here so the component
// only picks the colour from `tone`.
//
// Review 2026-11-28 (T1, first pass): one line that answers "can I redeem this?" right under "Inspect token".
// Second pass the same day (owner-approved mockup ~/Claude/refs/mintradar-inspectors-mockup-1128, T1/T2): the two
// checks are two separate states under the amount, because "not checked yet" next to a green "Verified" further down
// read as a contradiction. The signature check runs with Inspect (signatureState); the spent check only on "Check if
// spent" (tokenVerdict). The test-mint sentence is shown once by the component, not appended here.
import { classifySpentCheck, type SignatureCheck, type TokenSpentCheck } from '@/utils/cashuToken'

export type VerdictTone = 'ok' | 'bad' | 'warn' | 'neutral' | 'loading'

/** The spent check as the component holds it (null = not asked yet). */
export type VerdictSpent =
  | { status: 'ok'; data: TokenSpentCheck }
  | { status: 'error'; message: string }
  | { status: 'bad-mint-url'; message: string }
  | null

export interface TokenVerdictInput {
  spent: VerdictSpent
  checking: boolean
  /** The signatures check out and every keyset is listed by the mint (unspentConfidence() === 'confirmed'). */
  signaturesConfirmed: boolean
  mintName: string
  mintHost: string
}

export interface TokenVerdict {
  tone: VerdictTone
  /** The spent state's chip: "Spent: not checked yet", "Not spent", "Already spent", … */
  chip: string
  /** One sentence under the states, or '' when the chips say it all. */
  sub: string
}

function coins(n: number): string {
  return `${n} ${n === 1 ? 'coin' : 'coins'}`
}

export function tokenVerdict(i: TokenVerdictInput): TokenVerdict {
  if (i.checking) return { tone: 'loading', chip: 'Spent: asking the mint…', sub: '' }
  if (i.spent === null) return { tone: 'neutral', chip: 'Spent: not checked yet', sub: '' }
  if (i.spent.status === 'bad-mint-url') {
    return { tone: 'bad', chip: 'Not a usable mint', sub: `${i.spent.message} A legitimate Cashu token points at a public https:// mint.` }
  }
  if (i.spent.status === 'error') {
    return {
      tone: 'warn',
      chip: 'Spent status unknown',
      // The run's own message first ("Could not reach the mint." / "The mint didn't answer in time."), app-written.
      sub: `${i.spent.message} We could not ask whether these coins are spent. This says nothing about the token itself.`,
    }
  }
  const { total, unspent, spent, pending } = i.spent.data
  switch (classifySpentCheck(i.spent.data)) {
    case 'all-spent':
      return {
        tone: 'bad',
        chip: 'Already spent',
        sub: `${total === 1 ? 'The coin was' : `All ${coins(total)} were`} redeemed elsewhere. Nothing left to redeem.`,
      }
    case 'all-unspent':
      // Made-up proofs also come back unspent (the mint only looks up their hash): green needs confirmed signatures.
      return i.signaturesConfirmed
        ? { tone: 'ok', chip: 'Not spent', sub: '' }
        : {
          tone: 'neutral',
          chip: 'Not spent',
          sub: 'The mint has not marked these coins as spent. Its signatures could not be checked, so this does not prove the token is genuine.',
        }
    case 'all-pending':
      return { tone: 'neutral', chip: 'Spent: pending', sub: 'The mint is still processing these coins. Check again shortly.' }
    default:
      return {
        tone: 'warn',
        chip: 'Partly spent',
        sub: `${unspent} of ${coins(total)} unspent, ${spent} already spent${pending > 0 ? `, ${pending} pending` : ''}. A wallet can claim only the unspent ones.`,
      }
  }
}

/** The signature check as the component holds it (null before Verify answered). */
export type SignatureState = SignatureCheck | { status: 'unreachable' } | { status: 'bad-mint-url'; message: string } | null

/** The signature state's chip under the amount; the full sentence is the Signatures row of the details. */
export function signatureState(v: SignatureState, verifying: boolean, mintName: string): { tone: VerdictTone; chip: string } {
  if (verifying || v === null) return { tone: 'loading', chip: 'Checking signatures…' }
  switch (v.status) {
    case 'valid': return { tone: 'ok', chip: `Signed by ${mintName}` }
    case 'partial': return { tone: 'neutral', chip: `${v.checked} of ${v.total} signatures checked` }
    case 'no-dleq': return { tone: 'neutral', chip: "Signatures can't be checked" }
    case 'invalid': return { tone: 'warn', chip: "Signatures don't match this mint" }
    case 'bad-mint-url': return { tone: 'bad', chip: 'Not a usable mint' }
    default: return { tone: 'warn', chip: 'Signatures not checked' }
  }
}

