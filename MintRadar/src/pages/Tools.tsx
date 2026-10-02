import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcShield } from '@/components/mint/IcShield'
import { InfoTooltip } from '@/components/InfoTooltip'
import { useNow } from '@/hooks/useNow'
import { parseCashuToken, formatTokenAmount, decodeTokenWithMint, checkTokenSpentState, classifySignatureCheck, classifySpentCheck, tokenActionState, amountCarriesCurrencySymbol, stripTokenWhitespace, InvalidMintUrlError, type SignatureCheck, type TokenInfo, type TokenSpentCheck } from '@/utils/cashuToken'
import { startTokenRun, classifyRunError, createRunGuard, type TokenRun } from '@/utils/tokenRun'
import { normalizeMintUrl, reliabilityColor, reliabilityScoreInfo, displayName as mintDisplayName, cardReliabilityLabel, cardLightningLabel, computeDuplicateMintNames } from '@/utils/mintFormatting'
import { Zap, ShieldCheck, PlugZap, KeyRound, Lock, Satellite, ChevronDown, Search, LoaderCircle, CircleCheck, CircleX, CircleMinus, TriangleAlert, Hourglass, ExternalLink, ArrowRight, type LucideIcon } from 'lucide-react'
import { isTestMint } from '@/constants/testMints'
import { isEligibleForRecommendation } from '@/utils/reliabilityScore'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import './Tools.css'

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}


// DLEQ verification's outcome, once it has run. "unreachable" is deliberately distinct
// from "invalid": failing to reach the mint tells us nothing about the token, while
// "invalid" is a positive finding that the signature does not check out.
type VerifyResult =
  | SignatureCheck
  | { status: 'unreachable' }
  | { status: 'bad-mint-url'; message: string }

// The combined flow runs two phases back to back: a synchronous local parse, then a
// live DLEQ check against the mint. Tracked separately from VerifyResult so the button
// label and loading row can distinguish "reading the token" from "waiting on the
// network" instead of collapsing both into one generic spinner.
type Phase = 'idle' | 'inspecting' | 'verifying'

// The "Check if spent" NUT-07 check is a separate, user-initiated action from
// the Inspect & Verify flow above — it asks the mint a different question
// (has this proof already been redeemed?) and, unlike DLEQ, tells the mint
// operator that someone is looking at this specific token right now. Kept on
// its own state machine so it never fires automatically alongside inspection.
type SpentCheckResult =
  | { status: 'ok'; data: TokenSpentCheck }
  | { status: 'error'; message: string }
  | { status: 'bad-mint-url'; message: string }

// One result line in the Signature check / spent check panels. The tone is the whole
// visual ladder: ok = green, bad = red (a real finding against the token), unknown =
// copper (we couldn't find out — says nothing about the token), neutral = grey (nothing
// to report either way), loading = grey while a request is in flight.
type ResultTone = 'ok' | 'bad' | 'unknown' | 'neutral' | 'loading'
function ResultNote({ tone, Icon, children }: { tone: ResultTone; Icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div role="status" className={`token-verify-result tv-${tone}`}>
      <Icon size={14} aria-hidden="true" className={`tv-icon${tone === 'loading' ? ' tv-spin' : ''}`} />
      <span>{children}</span>
    </div>
  )
}

function TokenInspector({ knownMints }: { knownMints: KnownMint[] }) {
  const navigate = useNavigate()
  const now = useNow()
  const [input, setInput] = useState('')
  const [result, setResult] = useState<TokenInfo | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [inspected, setInspected] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  const [checkingSpent, setCheckingSpent] = useState(false)
  const [spentResult, setSpentResult] = useState<SpentCheckResult | null>(null)

  // Cancellation: one AbortController-backed run per Inspect and per Check, plus a run-id guard
  // per kind as belt and braces (each async path discards its result if its id has moved on).
  // Both are advanced on every textarea edit and on unmount; a new run of a kind advances its own.
  const inspectGuard = useRef(createRunGuard())
  const checkGuard = useRef(createRunGuard())
  const inspectRun = useRef<TokenRun | null>(null)
  const checkRun = useRef<TokenRun | null>(null)
  const invalidateRuns = () => {
    inspectGuard.current.next()
    checkGuard.current.next()
    inspectRun.current?.cancel()
    checkRun.current?.cancel()
    inspectRun.current = null
    checkRun.current = null
  }
  useEffect(() => invalidateRuns, [])

  const knownMap = useMemo(() => {
    const m = new Map<string, KnownMint>()
    for (const mint of knownMints) m.set(mint.url, mint)
    return m
  }, [knownMints])

  const mintInfo = useMemo(() => {
    if (!result) return null
    const normalized = normalizeMintUrl(result.mint)
    return knownMap.get(normalized) ?? knownMap.get(result.mint) ?? null
  }, [result, knownMap])

  // Pasted tokens often carry line breaks or stray spaces; a Cashu token never contains
  // whitespace, so all of it is stripped before parsing and before building the wallet links.
  const cleanToken = useMemo(() => stripTokenWhitespace(input), [input])

  const actions = tokenActionState(spentResult?.status === 'ok' ? spentResult.data : null)
  const mintOffline = mintInfo != null && mintInfo.online === false

  const handleInspectAndVerify = async () => {
    const token = cleanToken
    if (!token) return
    const id = inspectGuard.current.next()
    inspectRun.current?.cancel()
    inspectRun.current = null
    setInspected(true)
    setVerify(null)
    setSpentResult(null)
    setPhase('inspecting')

    // The local parse below is synchronous and effectively instant, so without a
    // deliberate minimum display time "Inspecting…" would never be perceptible — it'd
    // be replaced by "Verifying…" before a human eye could register it. This holds the
    // first phase on screen long enough to actually read, not just technically paint.
    await new Promise<void>(resolve => setTimeout(resolve, 300))
    if (!inspectGuard.current.isCurrent(id)) return

    const { info, error } = parseCashuToken(token)
    if (!info) {
      setParseError(error ?? 'Could not decode this token.')
      setResult(null)
      setPhase('idle')
      return
    }
    setParseError(null)
    setResult(info)

    // DLEQ needs the mint reachable, so a malformed token above never reaches this —
    // no wasted network call for input that was never going to verify anyway.
    setPhase('verifying')
    const run = startTokenRun()
    inspectRun.current = run
    let outcome: VerifyResult | null
    try {
      const decoded = await run.race(decodeTokenWithMint(token, { run }))
      // Only a DLEQ that was present AND checked AND failed is "invalid"; a missing DLEQ
      // or an unresolved keyset is never evidence against the token (see classifySignatureCheck).
      outcome = classifySignatureCheck(decoded.proofs)
    } catch (err) {
      if (err instanceof InvalidMintUrlError) {
        // The token names a mint URL we refuse to contact (not https://, or a
        // non-public host) — a positive finding about the token, not a transport
        // problem. No network request was made.
        outcome = { status: 'bad-mint-url', message: err.message }
      } else if (classifyRunError(err, run) === 'ignore') {
        outcome = null // edit / new run / unmount: silent, no state writes
      } else {
        // Our timeout, or any other throw: a transport/mint problem (loadMint failed, timeout,
        // keyset missing) — never evidence that the token itself is bad. The
        // parse result set above stays on screen regardless.
        outcome = { status: 'unreachable' }
      }
    } finally {
      run.finish()
      if (inspectRun.current === run) inspectRun.current = null
    }
    if (outcome === null || !inspectGuard.current.isCurrent(id)) return
    setVerify(outcome)
    setPhase('idle')
  }

  const handleCheckSpent = async () => {
    const token = cleanToken
    if (!token || checkingSpent) return
    const id = checkGuard.current.next()
    checkRun.current?.cancel()
    const run = startTokenRun()
    checkRun.current = run
    setCheckingSpent(true)
    setSpentResult(null)
    const startedAt = Date.now()

    let outcome: SpentCheckResult | null
    try {
      const data = await run.race(checkTokenSpentState(token, { run }))
      outcome = { status: 'ok', data }
    } catch (err) {
      if (err instanceof InvalidMintUrlError) {
        // No network request was made — the token names a mint URL we refuse to
        // contact. This IS a finding about the token.
        outcome = { status: 'bad-mint-url', message: err.message }
      } else {
        switch (classifyRunError(err, run)) {
          case 'ignore':
            outcome = null // edit / new run / unmount: silent, no state writes
            break
          case 'timeout':
            outcome = { status: 'error', message: "The mint didn't answer in time." }
            break
          default: {
            // Mint offline/unreachable, or the token itself couldn't be resolved —
            // either way this must not take down the rest of the inspector UI.
            const detail = err instanceof Error && err.message ? err.message : 'Could not reach the mint.'
            outcome = { status: 'error', message: detail }
          }
        }
      }
    } finally {
      run.finish()
      if (checkRun.current === run) checkRun.current = null
    }
    if (outcome === null || !checkGuard.current.isCurrent(id)) return

    // A local/cached mint response can resolve in well under 100ms, which made the
    // "Checking with mint…" label flash and vanish — read as a glitch rather than a
    // deliberate loading state. Holding the button on screen for at least 300ms total
    // (same floor used by the Inspect & Verify flow above) makes it read as an actual
    // network round trip regardless of how fast the real one was.
    const elapsed = Date.now() - startedAt
    if (elapsed < 300) await new Promise<void>(resolve => setTimeout(resolve, 300 - elapsed))
    if (!checkGuard.current.isCurrent(id)) return

    setSpentResult(outcome)
    setCheckingSpent(false)
  }

  return (
    <div className="tool-card">
      <div className="tool-header">
        <div className="tool-title">Token Inspector</div>
        <div className="tool-subtitle">Paste a Cashu token (cashuA or cashuB) to check its mint, amount and reliability before redeeming.</div>
      </div>

      <textarea
        className="token-input"
        placeholder="cashuB… or cashuA…"
        value={input}
        onChange={e => { invalidateRuns(); setInput(e.target.value); setInspected(false); setResult(null); setParseError(null); setVerify(null); setPhase('idle'); setSpentResult(null); setCheckingSpent(false) }}
        rows={3}
        spellCheck={false}
      />
      <div className="token-note">Decoded in your browser, so MintRadar's servers never see your token; checking contacts the mint named in it. "Open in cashu.me" puts the token in the link's #fragment, which browsers don't send to servers, though the wallet may leave it in the address bar and browser history. "Redeem to Lightning" opens the redeem page without the token, so you paste it there.</div>

      <button
        type="button"
        className="tool-btn-primary inspect-token-btn"
        onClick={() => void handleInspectAndVerify()}
        disabled={!cleanToken || phase !== 'idle'}
      >
        {phase === 'inspecting' ? <><Search size={14} aria-hidden="true" /> Inspecting…</>
          : phase === 'verifying' ? <><ShieldCheck size={14} aria-hidden="true" /> Verifying with mint…</>
          : 'Inspect & Verify Token'}
      </button>
      {!cleanToken && <div className="token-hint">Paste a token first</div>}

      {parseError && inspected && (
        <div className="token-error">{parseError}</div>
      )}

      {result && (
        <>
          <div className="token-result-grid">
            <div className="token-result-cell">
              <div className="trc-label">Mint</div>
              <div className="trc-mint">
                {/* Icon only for a mint we track, via the same proxied MintFavicon as the Dashboard.
                    An untracked token's mint URL is attacker-chosen, so nothing is requested for it. */}
                {mintInfo && <MintFavicon url={mintInfo.url} iconUrl={mintInfo.iconUrl} size={36} radius={9} className="trc-mint-icon" />}
                <div className="trc-mint-text">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <div className="trc-name">{mintInfo?.name ?? getHostname(result.mint)}</div>
                {isTestMint(mintInfo?.url ?? result.mint) && (
                  <span
                    className="token-test-mint-badge"
                    style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--amber)', background: 'var(--amber-soft)', border: '1px solid var(--amber-soft-strong)', borderRadius: 5, padding: '2px 7px' }}
                    title="Not for real funds — for testing and development only"
                  >
                    Test mint
                  </span>
                )}
              </div>
              <div className="trc-sub">{getHostname(result.mint)}</div>
                </div>
              </div>
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Amount</div>
              <div className="trc-value">{formatTokenAmount(result.amount, result.unit)}</div>
              {!amountCarriesCurrencySymbol(result.unit) && <div className="trc-sub">{result.unit}</div>}
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Mint Status</div>
              {mintInfo ? (
                <>
                  <div className="trc-value" style={{ color: mintInfo.online === true ? 'var(--accent)' : 'var(--red)' }}>
                    {mintInfo.online === true ? '● Online' : mintInfo.online === false ? '● Offline' : '○ Unknown'}
                  </div>
                  {mintInfo.lastCheckedAt && (
                    <div className="trc-sub">
                      checked {Math.round((now - new Date(mintInfo.lastCheckedAt).getTime()) / 60000)}m ago
                    </div>
                  )}
                </>
              ) : (
                <div className="trc-value trc-muted">Not in database</div>
              )}
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Reliability Score</div>
              {mintInfo?.reliabilityScore != null ? (
                <>
                  <div className="trc-value" style={{ color: reliabilityColor(mintInfo.reliabilityScore) }}>{mintInfo.reliabilityScore}%</div>
                  <div className="trc-sub" style={{ color: reliabilityColor(mintInfo.reliabilityScore) }}>
                    {reliabilityScoreInfo(mintInfo.reliabilityScore).label}
                  </div>
                </>
              ) : (
                <div className="trc-value trc-muted">—</div>
              )}
            </div>
          </div>

          <div className="token-details-row">
            <span className="tdr-item"><span className="tdr-label">Version</span>{result.version}</span>
            <span className="tdr-sep">·</span>
            {result.proofsCount !== null && (<>
              <span className="tdr-item"><span className="tdr-label">Proofs</span>{result.proofsCount}</span>
              <span className="tdr-sep">·</span>
            </>)}
            <span className="tdr-item"><span className="tdr-label">Unit</span>{result.unit}</span>
          </div>

          {result.memo && (
            <div className="token-memo-row"><span className="tdr-label">Memo</span> {result.memo}</div>
          )}

          <div className="token-verify">
            <div className="token-section-label">
              <span>Signature check</span>
              <InfoTooltip text="Each proof in a token can carry a mint signature proof (NUT-12 DLEQ). When it's there, we check it against the mint's public keys. A pass shows the proofs were signed by this mint. It doesn't show whether they're spent (use Check if spent) or how reliable the mint is (see the score above)." />
            </div>
            {phase === 'verifying' && (
              <ResultNote tone="loading" Icon={LoaderCircle}>Verifying with mint… checking this token's signatures.</ResultNote>
            )}
            {verify?.status === 'valid' && (
              <ResultNote tone="ok" Icon={CircleCheck}>Verified. Every proof is signed by this mint. This doesn't show whether it's spent.</ResultNote>
            )}
            {verify?.status === 'invalid' && (
              <ResultNote tone="bad" Icon={CircleX}>Invalid signature — do not trust this token. At least one signature proof failed its check.</ResultNote>
            )}
            {verify?.status === 'partial' && (
              <ResultNote tone="neutral" Icon={CircleMinus}>
                Partly verified. {verify.checked} of {verify.total} proofs carry signature proofs and those check out. The rest can't be checked.
              </ResultNote>
            )}
            {verify?.status === 'unresolved' && (
              <ResultNote tone="unknown" Icon={TriangleAlert}>Couldn't check signatures. Says nothing about the token itself.</ResultNote>
            )}
            {verify?.status === 'no-dleq' && (
              <ResultNote tone="neutral" Icon={CircleMinus}>
                Signatures can't be checked. This token has no signature proofs attached. That doesn't mean it's bad.
              </ResultNote>
            )}
            {verify?.status === 'unreachable' && (
              <ResultNote tone="unknown" Icon={TriangleAlert}>Could not reach mint to verify (try again later). This says nothing about the token itself.</ResultNote>
            )}
            {verify?.status === 'bad-mint-url' && (
              <ResultNote tone="bad" Icon={CircleX}>{verify.message} A legitimate Cashu token points at a public https:// mint.</ResultNote>
            )}
          </div>

          {mintOffline && (
            <div className="token-note">This mint didn't answer its last check, so checking or redeeming may not work.</div>
          )}

          <div className="token-spent">
            <button
              type="button"
              className={`token-action-btn${actions.accent === 'check' ? ' token-action-accent' : ''}`}
              onClick={() => void handleCheckSpent()}
              disabled={checkingSpent}
            >
              {checkingSpent
                ? <><LoaderCircle size={13} aria-hidden="true" className="tv-spin" /> Checking with mint…</>
                : <><Search size={13} aria-hidden="true" /> {spentResult ? 'Check again' : 'Check if spent'}</>}
            </button>
            {!spentResult && (
              <span className="token-spent-caption">Asks the mint. It will see that you checked.</span>
            )}

            {spentResult?.status === 'ok' && (() => {
              const { total, unspent, spent, pending } = spentResult.data
              const plural = total === 1 ? '' : 's'
              switch (classifySpentCheck(spentResult.data)) {
                case 'all-spent':
                  return <ResultNote tone="bad" Icon={CircleX}>All {total} proof{plural} already spent — this token has already been redeemed elsewhere.</ResultNote>
                case 'all-unspent':
                  return <ResultNote tone="ok" Icon={CircleCheck}>All {total} proof{plural} unspent — this token has not been redeemed yet.</ResultNote>
                case 'all-pending':
                  return <ResultNote tone="neutral" Icon={Hourglass}>All {total} proof{plural} pending — the mint is still processing {total === 1 ? 'it' : 'them'}. Check again shortly.</ResultNote>
                default:
                  return (
                    <ResultNote tone="unknown" Icon={TriangleAlert}>
                      {unspent}/{total} proofs unspent, {spent} already spent{pending > 0 ? `, ${pending} pending` : ''} — this token is only partially usable.
                    </ResultNote>
                  )
              }
            })()}
            {spentResult?.status === 'error' && (
              <ResultNote tone="unknown" Icon={TriangleAlert}>Could not check spent status — {spentResult.message} This says nothing about the token itself.</ResultNote>
            )}
            {spentResult?.status === 'bad-mint-url' && (
              <ResultNote tone="bad" Icon={CircleX}>{spentResult.message} A legitimate Cashu token points at a public https:// mint.</ResultNote>
            )}
          </div>

          <div className="token-actions">
            {/* Verified against the tools' own sources, not guessed. wallet.cashu.me reads
                `#token=` in WalletPage.vue's created() hook (cashubtc/cashu.me) and takes
                everything after it verbatim — no URL-decoding — so the raw token goes in the
                fragment, which browsers never send to a server (it never appears in a query
                string). redeem.cashu.me only pre-fills the token when `lightning`, `ln` or `to`
                is also present (cashubtc/cashu-redeem), so that link carries nothing and the
                user pastes the token there. The privacy line under the textarea says so. */}
            {actions.redeemDisabled ? (
              <span className="token-action-btn" aria-disabled="true">
                <Zap size={13} aria-hidden="true" /> Redeem to Lightning
              </span>
            ) : (
              <a
                className={`token-action-btn${actions.accent === 'redeem' ? ' token-action-accent' : ''}`}
                href="https://redeem.cashu.me/"
                target="_blank"
                rel="noopener noreferrer"
                title="Opens the Cashu redeem page. Paste your token there."
              >
                <Zap size={13} aria-hidden="true" /> Redeem to Lightning
              </a>
            )}
            {mintInfo && (
              <button type="button" className="token-action-btn" onClick={() => navigate(`/mint/${encodeURIComponent(result.mint)}`)}>
                View Mint Detail <ArrowRight size={12} aria-hidden="true" />
              </button>
            )}
            {actions.showOpenInWallet && (
              <a
                className="token-action-btn"
                href={`https://wallet.cashu.me/#token=${cleanToken}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in cashu.me <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
          </div>
          {!actions.redeemDisabled && <div className="token-note">Paste your token on the redeem page.</div>}
          {actions.note === 'nothing-left' && <div className="token-note">Nothing left to redeem.</div>}
        </>
      )}
    </div>
  )
}

// "Fast"/"Reliable" drive the scoring weights below; the other four are pure
// filters (a mint either qualifies or it doesn't). There is deliberately no
// generic "Features" option — every check here maps to one specific,
// reliably-tracked capability (P2PK/NUT-11 and WebSocket/NUT-17 are both at
// ~94-100% adoption across tracked mints per /api/stats' nutAdoption, so a
// checkbox against them isn't filtering against mostly-null data — unlike
// e.g. MPP/NUT-15 at ~63%, deliberately left out).
type WizardCheck = 'fast' | 'reliable' | 'ln' | 'seed' | 'p2pk' | 'ws'
type SizeOption = 'small' | 'medium' | 'large'

interface UnitLimits { min: number | null; max: number | null }
interface WizardRec {
  url: string
  mint: KnownMint
  score: number
  latencyMs: number | null
  mintLimits: UnitLimits | null
  meltLimits: UnitLimits | null
}

// Collapses a mint's NUT-04/NUT-05 method entries for one unit into a single
// min/max range — a mint can advertise several methods (bolt11, bolt12, …) per
// unit, each with its own limits, so the widest usable range is what the user
// actually faces.
function limitsForUnit(methods: KnownMint['mintMethods'], unit: string): UnitLimits | null {
  const forUnit = (methods ?? []).filter(m => m.unit === unit)
  if (forUnit.length === 0) return null
  const mins: number[] = []
  const maxs: number[] = []
  for (const m of forUnit) {
    const min = m['min_amount']
    const max = m['max_amount']
    if (typeof min === 'number') mins.push(min)
    if (typeof max === 'number') maxs.push(max)
  }
  if (mins.length === 0 && maxs.length === 0) return null
  return {
    min: mins.length > 0 ? Math.min(...mins) : null,
    max: maxs.length > 0 ? Math.max(...maxs) : null,
  }
}

function formatCompactAmount(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (n >= 1_000) {
    const k = n / 1_000
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`
  }
  return String(n)
}

function formatLimits(limits: UnitLimits | null, unit: string): string | null {
  if (!limits) return null
  const min = limits.min !== null ? formatCompactAmount(limits.min) : '—'
  const max = limits.max !== null ? formatCompactAmount(limits.max) : '∞'
  return `${min}–${max} ${unit}`
}

type Weights = { latency: number; reliability: number; nuts: number }

const FAST_WEIGHTS: Weights = { latency: 0.6, reliability: 0.3, nuts: 0.1 }
const RELIABLE_WEIGHTS: Weights = { latency: 0.2, reliability: 0.7, nuts: 0.1 }

// Fast+Reliable both checked → average the two vectors (each already sums to
// 1, so the average does too — no separate re-normalization step needed).
// Neither checked (only filter-type checks selected) → falls back to the
// Reliable weights, per spec.
function baseWeightsFor(checks: Set<WizardCheck>): Weights {
  const fast = checks.has('fast')
  const reliable = checks.has('reliable')
  if (fast && reliable) {
    return {
      latency: (FAST_WEIGHTS.latency + RELIABLE_WEIGHTS.latency) / 2,
      reliability: (FAST_WEIGHTS.reliability + RELIABLE_WEIGHTS.reliability) / 2,
      nuts: (FAST_WEIGHTS.nuts + RELIABLE_WEIGHTS.nuts) / 2,
    }
  }
  if (fast) return FAST_WEIGHTS
  return RELIABLE_WEIGHTS
}

// Larger stored balances carry more risk if the mint turns out unreliable, so
// shift weight toward reliability — proportionally reducing latency/nuts so the
// three weights still sum to 1.
const LARGE_RELIABILITY_BOOST = 0.15

function weightsFor(checks: Set<WizardCheck>, size: SizeOption): Weights {
  const base = baseWeightsFor(checks)
  if (size !== 'large') return base
  const scale = (1 - base.reliability - LARGE_RELIABILITY_BOOST) / (1 - base.reliability)
  return { latency: base.latency * scale, reliability: base.reliability + LARGE_RELIABILITY_BOOST, nuts: base.nuts * scale }
}

// Display order of the currency segmented control. Units not listed here
// (a mint advertising something new) sort after these, alphabetically.
const UNIT_ORDER = ['sat', 'msat', 'eur', 'usd']
const unitRank = (u: string) => { const i = UNIT_ORDER.indexOf(u); return i === -1 ? UNIT_ORDER.length : i }

// Rough balance-size thresholds per unit, shown as labels only — `size` is a bucket
// key, never compared against an amount. Deliberately static and approximate (no FX
// rate); sat is the reference, the rest are ballpark equivalents. A unit not listed
// here gets no threshold hint rather than a wrong one.
const SIZE_HINTS: Record<string, [string, string, string]> = {
  sat: ['< 10k sats', '10k–100k sats', '> 100k sats'],
  msat: ['< ~10M msat', '~10M–100M msat', '> ~100M msat'],
  eur: ['< ~€10', '~€10–100', '> ~€100'],
  usd: ['< ~$10', '~$10–100', '> ~$100'],
}

// Basic checks are always shown; advanced ones sit behind a disclosure. Purely
// presentational — all six are still plain WizardCheck booleans.
const BASIC_CHECKS: { id: WizardCheck; label: string; sub: string; Icon: LucideIcon }[] = [
  { id: 'fast', label: 'Fast from here', sub: 'Ranks mints by real latency from your browser', Icon: Zap },
  { id: 'reliable', label: 'Reliable', sub: 'Ranks mints by track record and uptime', Icon: ShieldCheck },
  { id: 'ln', label: 'Lightning in and out', sub: 'Only show mints that support both deposits and withdrawals', Icon: PlugZap },
]
const ADVANCED_CHECKS: { id: WizardCheck; label: string; sub: string; Icon: LucideIcon }[] = [
  { id: 'seed', label: 'Restore from seed', sub: 'Can recover your funds from a backup phrase', Icon: KeyRound },
  { id: 'p2pk', label: 'Locked payments', sub: 'For apps that lock funds to a specific key, like escrow', Icon: Lock },
  { id: 'ws', label: 'Live updates', sub: 'Balance updates instantly, no manual refresh', Icon: Satellite },
]

function BestMintWizard({ knownMints }: { knownMints: KnownMint[] }) {
  const navigate = useNavigate()
  // Computed over the full known-mints list — see Dashboard.tsx's own
  // duplicateDisplayNames for the rationale.
  const duplicateDisplayNames = useMemo(() => computeDuplicateMintNames(knownMints), [knownMints])
  const [step, setStep] = useState(1)
  const [unit, setUnit] = useState<string | null>(null)
  const [size, setSize] = useState<SizeOption | null>(null)
  const [checks, setChecks] = useState<Set<WizardCheck>>(new Set())
  const [finding, setFinding] = useState(false)
  const [recs, setRecs] = useState<WizardRec[] | null>(null)
  const [recsUnit, setRecsUnit] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Built from the distinct units the online mints actually advertise, never a
  // hardcoded sat/usd/eur list — a mint offering a new unit shows up here on its
  // own. 'sat' is pinned first because it is the ecosystem default.
  const availableUnits = useMemo(() => {
    const set = new Set<string>()
    for (const m of knownMints) {
      if (m.online !== true) continue
      for (const u of m.units ?? []) set.add(u)
    }
    return [...set].sort((a, b) => unitRank(a) - unitRank(b) || a.localeCompare(b))
  }, [knownMints])

  const selectedUnit = unit ?? availableUnits[0] ?? null

  const sizeHints = selectedUnit ? SIZE_HINTS[selectedUnit] : undefined

  const advancedSelected = ADVANCED_CHECKS.filter(o => checks.has(o.id)).length

  const toggleCheck = (id: WizardCheck) => setChecks(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const ready = selectedUnit !== null && size !== null && checks.size > 0

  const handleFind = async () => {
    if (checks.size === 0 || !size || !selectedUnit) return
    setFinding(true)
    setRecs(null)

    const candidates = knownMints
      .filter(m => m.online === true && m.reliabilityScore != null)
      // Dev/test-only mints (fake sats, "do not use as default", etc.) are
      // real and findable via Dashboard/Watchlist/Search, but the wizard is
      // an active recommendation — never suggest one as someone's mint.
      .filter(m => !isTestMint(m.url))
      // Same 14-day minimum-age gate as the Reliability Score top-5 surfaces (Stats,
      // /api/stats) — a brand-new mint shouldn't be actively recommended here
      // just because it hasn't accumulated enough history to be penalized yet.
      .filter(m => isEligibleForRecommendation(m.discoveredAt))
      // A mint that doesn't issue this unit can't serve the user at all, so it
      // is dropped before scoring rather than ranked and then explained away.
      .filter(m => (m.units ?? []).includes(selectedUnit))
      // NUT-9 (restore signatures) is the mint-side capability that actually
      // gates seed-phrase backup/restore — see the note in MintDetail.tsx.
      .filter(m => !checks.has('seed') || m.nutsLimits?.['9'] != null)
      // P2PK (NUT-11) — locking ecash to a public key.
      .filter(m => !checks.has('p2pk') || m.nutsLimits?.['11'] != null)
      // WebSocket (NUT-17) — live balance/payment update subscriptions.
      .filter(m => !checks.has('ws') || m.nutsLimits?.['17'] != null)
      // Lightning in + out means both mint (deposit) and melt (withdraw) support
      // bolt11/bolt12 — cardLightningLabel() only returns 'LN' when both sides do.
      .filter(m => !checks.has('ln') || cardLightningLabel(m) === 'LN')
      .sort((a, b) => (b.reliabilityScore ?? 0) - (a.reliabilityScore ?? 0))
      .slice(0, 20)

    const w = weightsFor(checks, size)

    const latencyResults = await Promise.allSettled(
      candidates.map(async m => {
        const start = Date.now()
        try {
          const r = await fetch(`${m.url}/v1/info`, { signal: AbortSignal.timeout(5000) })
          if (!r.ok) return { url: m.url, latencyMs: null }
          return { url: m.url, latencyMs: Date.now() - start }
        } catch { return { url: m.url, latencyMs: null } }
      })
    )

    const latencyMap = new Map<string, number | null>()
    for (const r of latencyResults) {
      if (r.status === 'fulfilled') latencyMap.set(r.value.url, r.value.latencyMs)
    }

    const maxLatency = Math.max(...[...latencyMap.values()].filter((v): v is number => v !== null), 1)
    const maxNuts = Math.max(...candidates.map(m => m.nutCount ?? 0), 1)

    const scored: WizardRec[] = candidates.map(m => {
      const latMs = latencyMap.get(m.url) ?? null
      const latScore = latMs !== null ? 1 - latMs / maxLatency : 0
      const reliabilityScore = (m.reliabilityScore ?? 0) / 100
      const nutsScore = (m.nutCount ?? 0) / maxNuts
      return {
        url: m.url,
        mint: m,
        score: w.latency * latScore + w.reliability * reliabilityScore + w.nuts * nutsScore,
        latencyMs: latMs,
        mintLimits: limitsForUnit(m.mintMethods ?? null, selectedUnit),
        meltLimits: limitsForUnit(m.meltMethods ?? null, selectedUnit),
      }
    }).sort((a, b) => b.score - a.score).slice(0, 3)

    setRecs(scored)
    setRecsUnit(selectedUnit)
    setFinding(false)
  }

  const renderCheck = ({ id, label, sub, Icon }: typeof BASIC_CHECKS[number]) => {
    const active = checks.has(id)
    return (
      <button key={id} type="button" className={`wizard-opt wizard-opt-check${active ? ' active' : ''}`}
        aria-pressed={active} onClick={() => toggleCheck(id)}>
        <Icon size={18} aria-hidden="true" className="wizard-opt-icon" />
        <div className="wizard-opt-text">
          <div className="wizard-opt-label">{label}</div>
          <div className="wizard-opt-sub">{sub}</div>
        </div>
      </button>
    )
  }

  return (
    <div className="tool-card">
      <div className="tool-header">
        <div className="tool-title">Best Mint for Me</div>
        <div className="tool-subtitle">Answer a few quick questions and we'll recommend the best mints for your needs</div>
      </div>

      <div className="wizard-steps">
        {[1, 2].map(n => (
          <div key={n} className={`wizard-step-dot${step >= n ? ' active' : ''}${step > n ? ' done' : ''}`}>
            {step > n ? '✓' : n}
          </div>
        ))}
        <div className="wizard-step-line" />
      </div>

      {step === 1 && (
        <div className="wizard-step-body">
          <div className="wizard-q">Which currency do you want to hold?</div>
          {availableUnits.length === 0 ? (
            <div className="wizard-no-results">No unit data available yet — mints report their units on the next probe cycle.</div>
          ) : (
            <div className="wizard-unit-seg" role="radiogroup" aria-label="Currency unit">
              {availableUnits.map(u => (
                <button key={u} type="button" role="radio" aria-checked={u === selectedUnit}
                  className={`wizard-unit-opt${u === selectedUnit ? ' active' : ''}`}
                  onClick={() => { setUnit(u); setRecs(null) }}>
                  {u.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <div className="wizard-q">How much do you plan to store?</div>
          <div className="wizard-options">
            {[
              { id: 'small' as SizeOption, label: 'Small', sub: sizeHints?.[0] },
              { id: 'medium' as SizeOption, label: 'Medium', sub: sizeHints?.[1] },
              { id: 'large' as SizeOption, label: 'Large', sub: sizeHints?.[2] },
            ].map(opt => (
              <button key={opt.id} type="button" className={`wizard-opt${size === opt.id ? ' active' : ''}`}
                onClick={() => { setSize(opt.id); setStep(2) }}>
                <div className="wizard-opt-label">{opt.label}</div>
                {opt.sub && <div className="wizard-opt-sub">{opt.sub}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-step-body">
          <div className="wizard-q">What matters to you? (pick any)</div>
          <div className="wizard-options">
            {BASIC_CHECKS.map(renderCheck)}
          </div>
          <button type="button" className="wizard-adv-toggle" aria-expanded={advancedOpen}
            aria-controls={advancedOpen ? 'wizard-advanced' : undefined}
            onClick={() => setAdvancedOpen(o => !o)}>
            <span>Advanced options{advancedSelected > 0 ? ` · ${advancedSelected} selected` : ''}</span>
            <ChevronDown size={16} aria-hidden="true" className="wizard-adv-chevron" />
          </button>
          {advancedOpen && (
            <div id="wizard-advanced" className="wizard-options">
              {ADVANCED_CHECKS.map(renderCheck)}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <button type="button" className="tool-btn-primary find-my-mint-btn" disabled={!ready || finding} onClick={() => void handleFind()}>
          {finding ? 'Measuring latency…' : 'Find my mint →'}
        </button>
      )}
      {step === 2 && checks.size === 0 && <div className="wizard-hint">Pick at least one</div>}

      {step > 1 && !recs && (
        <button type="button" className="wizard-back-btn" onClick={() => { setStep(s => s - 1); setRecs(null) }}>
          ← Back
        </button>
      )}

      {recs !== null && (
        <div className="wizard-results">
          {recs.length === 0 ? (
            <div className="wizard-no-results">No online mint supports {recsUnit} with the options you picked. Try another currency or change your answers.</div>
          ) : (
            <>
            {recs.length < 3 && (
              <div className="wizard-rec-count-note">
                Only {recs.length} matching {recs.length === 1 ? 'mint' : 'mints'} found for {recsUnit} with these options — showing what's available.
              </div>
            )}
            {recs.map((rec, idx) => {
              const reliabilityNum = rec.mint.reliabilityScore ?? null
              const reliabilityCol = reliabilityNum == null ? 'var(--t3)' : reliabilityNum >= 70 ? 'var(--green-bright)' : reliabilityNum >= 40 ? 'var(--amber)' : 'var(--red)'
              const lnLabel = cardLightningLabel(rec.mint)
              const unitLabel = recsUnit ?? ''
              const mintRange = formatLimits(rec.mintLimits, unitLabel)
              const meltRange = formatLimits(rec.meltLimits, unitLabel)
              return (
                <div key={rec.url} className="wizard-rec-row" onClick={() => navigate(`/mint/${encodeURIComponent(rec.url)}`)}>
                  <span className="wizard-rank">#{idx + 1}</span>
                  <MintFavicon url={rec.url} iconUrl={rec.mint.iconUrl ?? null} size={28} radius={6} />
                  <div className="wizard-rec-info">
                    <div className="wizard-rec-name">{mintDisplayName(rec.mint, duplicateDisplayNames)}</div>
                    <div className="wizard-rec-meta">
                      {rec.latencyMs != null && <span>{rec.latencyMs}ms latency</span>}
                      {rec.mint.uptimePct24h != null && <span> · {rec.mint.uptimePct24h}% uptime</span>}
                    </div>
                    <div className="wizard-rec-limits">
                      {(mintRange ?? meltRange) !== null ? (
                        <>
                          {mintRange && <span>Mint {mintRange}</span>}
                          {mintRange && meltRange && <span> · </span>}
                          {meltRange && <span>Melt {meltRange}</span>}
                        </>
                      ) : (
                        <span>No {unitLabel} limits published by this mint</span>
                      )}
                    </div>
                  </div>
                  <span className="wizard-rec-badges">
                    <span className="wizard-rec-reliability" style={{ color: reliabilityCol }}>
                      <IcShield size={11} /><span>{cardReliabilityLabel(reliabilityNum)}</span>
                    </span>
                    {lnLabel && (
                      <span className="wizard-rec-ln">
                        <Zap size={10} aria-hidden /><span>{lnLabel}</span>
                      </span>
                    )}
                  </span>
                  <span className="wizard-rec-view">View →</span>
                </div>
              )
            })}
            </>
          )}
          {recs.length > 0 && (
            <div className="wizard-rec-note">
              Reliability Score reflects the whole mint, not this specific currency — uptime, NUT support and
              version freshness are measured per mint. Only the limits above are {recsUnit}-specific.
            </div>
          )}
          <button type="button" className="wizard-start-over-btn"
            onClick={() => { setStep(1); setSize(null); setChecks(new Set()); setRecs(null); setRecsUnit(null) }}>
            ← Start over
          </button>
        </div>
      )}
    </div>
  )
}

export default function Tools() {
  const { data: knownMintsData } = useKnownMints()
  const mints = knownMintsData ?? []

  // Deep links: #pick focuses the wizard, #token the inspector.
  // Honoured on first load and on hashchange.
  useEffect(() => {
    const applyHash = () => {
      const target = window.location.hash.replace('#', '')
      if (target !== 'pick' && target !== 'token') return
      const el = document.getElementById(target)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.focus({ preventScroll: true })
      document.querySelectorAll('.tool-anchor-hl').forEach(n => n.classList.remove('tool-anchor-hl'))
      el.classList.add('tool-anchor-hl')
      window.setTimeout(() => el.classList.remove('tool-anchor-hl'), 2800)
    }
    requestAnimationFrame(applyHash)
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  useDocumentMeta(
    'Cashu Mint Tools - Token Inspector & Best Mint Finder | MintRadar',
    'Inspect a Cashu token before redeeming it, or find the best Cashu mint for you with the Best Mint wizard.'
  )

  return (
    <div className="tools-page">
      <h1 className="sr-only">Cashu Mint Tools — Token Inspector & Best Mint Finder</h1>
      <div className="tools-grid">
        <div id="token" tabIndex={-1} className="tool-anchor">
          <TokenInspector knownMints={mints} />
        </div>
        <div id="pick" tabIndex={-1} className="tool-anchor">
          <BestMintWizard knownMints={mints} />
        </div>
      </div>
    </div>
  )
}
