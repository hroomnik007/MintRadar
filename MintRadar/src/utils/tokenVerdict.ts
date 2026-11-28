// Token inspector, the result block at the top (review 2026-11-28, T1): one line that answers "can I redeem this?" right
// under "Inspect token", with the details (Decode, Verify, Mint fee) below it. Pure, no React; the wording of every
// state lives here so the component only picks the icon and the colour from `tone`.
import { classifySpentCheck, type TokenSpentCheck } from '@/utils/cashuToken'

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
  testMint: boolean
}

export interface TokenVerdict {
  tone: VerdictTone
  /** Follows the amount: "<amount> · <title>". */
  title: string
  sub: string
}

const TEST_MINT_LINE = 'Ecash from a test mint has no value.'

function coins(n: number): string {
  return `${n} ${n === 1 ? 'coin' : 'coins'}`
}

export function tokenVerdict(i: TokenVerdictInput): TokenVerdict {
  const withTest = (sub: string) => (i.testMint ? `${sub} ${TEST_MINT_LINE}` : sub)
  if (i.checking) {
    return { tone: 'loading', title: 'asking the mint…', sub: `Asking ${i.mintHost} whether these coins were spent.` }
  }
  if (i.spent === null) {
    return {
      tone: 'neutral',
      title: 'not checked yet',
      sub: withTest('“Check if spent” asks the mint whether these coins were redeemed. The mint will see that you checked.'),
    }
  }
  if (i.spent.status === 'bad-mint-url') {
    return { tone: 'bad', title: 'not a usable mint', sub: `${i.spent.message} A legitimate Cashu token points at a public https:// mint.` }
  }
  if (i.spent.status === 'error') {
    return {
      tone: 'warn',
      title: 'spent status unknown',
      // The run's own message first ("Could not reach the mint." / "The mint didn't answer in time."), app-written.
      sub: `${i.spent.message} We could not ask whether these coins are spent. This says nothing about the token itself.`,
    }
  }
  const { total, unspent, spent, pending } = i.spent.data
  switch (classifySpentCheck(i.spent.data)) {
    case 'all-spent':
      return {
        tone: 'bad',
        title: 'already spent',
        sub: `${total === 1 ? 'The coin was' : `All ${coins(total)} were`} redeemed elsewhere. Nothing left to redeem.`,
      }
    case 'all-unspent':
      // Made-up proofs also come back unspent (the mint only looks up their hash): green needs confirmed signatures.
      return i.signaturesConfirmed
        ? { tone: 'ok', title: 'ready to redeem', sub: withTest(`Signed by ${i.mintName} and not spent yet.`) }
        : {
          tone: 'neutral',
          title: 'not spent yet',
          sub: withTest('The mint has not marked these coins as spent. Its signatures could not be checked, so this does not prove the token is genuine.'),
        }
    case 'all-pending':
      return { tone: 'neutral', title: 'pending', sub: 'The mint is still processing these coins. Check again shortly.' }
    default:
      return {
        tone: 'warn',
        title: 'partly spent',
        sub: `${unspent} of ${coins(total)} unspent, ${spent} already spent${pending > 0 ? `, ${pending} pending` : ''}. A wallet can claim only the unspent ones.`,
      }
  }
}
