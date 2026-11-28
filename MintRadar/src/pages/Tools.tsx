import { SIGNATURE_CHECK_TEXT, CLAIM_FEE_TEXT, TEST_MINT_TEXT } from '@/utils/tooltipTexts'
import { useState, useMemo, useEffect, useRef } from 'react'
import { passesWizardNutChecks } from '@/utils/nutFilters'
import { Link, useNavigate } from 'react-router-dom'
import { useKnownMints, type KnownMint } from '@/hooks/useKnownMints'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { InfoTooltip } from '@/components/InfoTooltip'
import { useNow } from '@/hooks/useNow'
import { parseCashuToken, formatTokenAmount, decodeTokenWithMint, checkTokenSpentState, classifySignatureCheck, classifySpentCheck, tokenActionState, amountCarriesCurrencySymbol, stripTokenWhitespace, InvalidMintUrlError, tokenFeeFacts, localProofKeysetIds, unspentConfidence, unknownKeysetIds, type SignatureCheck, type TokenInfo, type TokenSpentCheck, type TokenFeeFacts } from '@/utils/cashuToken'
import { feeUnitLabel, formatFeeRate } from '@/utils/feesLimits'
import { startTokenRun, classifyRunError, createRunGuard, type TokenRun } from '@/utils/tokenRun'
import { normalizeMintUrl, reliabilityColor, reliabilityScoreInfo, displayName as mintDisplayName, cardReliabilityLabel, cardLightningLabel, computeDuplicateMintNames } from '@/utils/mintFormatting'
import { PaymentRequestInspector } from '@/components/PaymentRequestInspector'
import { PageHead } from '@/components/layout/PageHead'
import { Zap, Check, ShieldCheck, PlugZap, KeyRound, Lock, Satellite, ChevronDown, Search, LoaderCircle, CircleCheck, CircleX, CircleMinus, TriangleAlert, Coins, ExternalLink, Info, type LucideIcon } from 'lucide-react'
import { isTestMint } from '@/constants/testMints'
import { isNotRecommendedMint } from '@/utils/notRecommended'
import { isEligibleForRecommendation, hasFreshProbe, hasSteadyUptime } from '@/utils/reliabilityScore'
import { weightsFor, reviewsScore, latencyPart, softwarePreferenceCredit, whyBestReasons, whyBestText, type WizardCheck, type SizeOption, type WizardParts } from '@/utils/wizardScoring'
import { softwareChoices, rankWizardRecs, matchesPreferredSoftware, wizardReasonText, reasonMentionsLatency, latencyLimitNote, latencyLimitEmptyText, LATENCY_LIMITS, type LatencyLimit } from '@/utils/wizardPick'
import { wizardOffersUnit } from '@/utils/wizardUnits'
import { tokenVerdict, type VerdictTone } from '@/utils/tokenVerdict'
import { sortUnits } from '@/utils/sortUnits'
import { formatDateTimeUtc } from '@/utils/formatDate'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { ROUTE_META_BY_PATH } from '@/utils/pageMeta'
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
// `fee` styles the line the same way under its own class, so the Signature check line stays the one .token-verify-result.
function ResultNote({ tone, Icon, children, fee = false }: { tone: ResultTone; Icon: LucideIcon; children: React.ReactNode; fee?: boolean }) {
  return (
    <div role="status" className={`${fee ? 'token-fee-result' : 'token-verify-result'} tv-${tone}`}>
      <Icon size={14} aria-hidden="true" className={`tv-icon${tone === 'loading' ? ' tv-spin' : ''}`} />
      <span>{children}</span>
    </div>
  )
}

/** "2 sat", "$0.02": an amount in the token's unit. */
function amountInUnit(amount: number, unit: string): string {
  return amountCarriesCurrencySymbol(unit) ? formatTokenAmount(amount, unit) : `${formatTokenAmount(amount, unit)} ${unit}`
}

/**
 * The Verify part's "Mint fee" block: the exact NUT-02 claim fee and the status of each keyset the coins come from.
 * `source` says where the keysets came from: the mint just now, or MintRadar's last stored keysets check.
 */
function ClaimFee({ facts, unit, source, storedAt }: { facts: TokenFeeFacts | null; unit: string; source: 'mint' | 'stored' | 'none'; storedAt?: string | null }) {
  const unknownFromMint = source === 'mint' ? 'the mint does not list' : "the mint's last listed keysets do not include"
  const unknownIds = facts?.keysets.filter(k => k.status === 'unknown').map(k => k.id) ?? []
  return (
    <div className="token-verify" data-testid="token-claim-fee">
      <div className="token-section-label">
        <span>Mint fee</span>
        <InfoTooltip text={CLAIM_FEE_TEXT} about="Mint fee" />
      </div>
      {!facts || facts.fee === null ? (
        <ResultNote fee tone="unknown" Icon={TriangleAlert}>
          {!facts
            ? 'Mint fee unknown: the mint could not be reached.'
            : `Mint fee unknown: ${unknownFromMint} ${unknownIds.length === 1 ? 'this keyset' : 'these keysets'}.`}
        </ResultNote>
      ) : facts.fee === 0 ? (
        <ResultNote fee tone="neutral" Icon={CircleMinus}>No mint fee to claim this token.</ResultNote>
      ) : (
        <ResultNote fee tone="neutral" Icon={Coins}>Claiming this token costs {amountInUnit(facts.fee, unit)} in mint fees.</ResultNote>
      )}
      {facts && facts.keysets.length > 0 && (
        <ul className="token-keysets" data-testid="token-keyset-status">
          {facts.keysets.map(k => (
            <li key={k.id} className="token-keyset">
              <span className="token-keyset-id">{k.id}</span>
              <span className="token-keyset-meta">
                {k.proofs} {k.proofs === 1 ? 'coin' : 'coins'}
                {k.inputFeePpk !== null && <> · {k.inputFeePpk === 0 ? 'no input fee' : `${formatFeeRate(k.inputFeePpk)} ${feeUnitLabel(unit)} per coin`}</>}
              </span>
              <span className={`token-keyset-status tks-${k.status}`}>
                {k.status === 'active' && 'Active'}
                {k.status === 'inactive' && 'Inactive. The mint no longer issues coins from this keyset. Swap these coins to an active keyset soon.'}
                {k.status === 'unknown' && (source === 'mint' ? 'Unknown. Not listed by the mint.' : "Unknown. Not in the mint's last listed keysets.")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {source === 'stored' && (
        <div className="token-source" data-testid="token-claim-fee-source">
          From MintRadar's last keyset check{storedAt ? ` (${formatDateTimeUtc(storedAt)})` : ''}. The mint did not answer now.
        </div>
      )}
    </div>
  )
}

const VERDICT_ICON: Record<VerdictTone, LucideIcon> = { ok: CircleCheck, bad: CircleX, warn: TriangleAlert, neutral: CircleMinus, loading: LoaderCircle }

/** Whether MintRadar's known-mints list has loaded: "Not in database" is only true once it has. */
type ListState = 'ready' | 'loading' | 'error'

function TokenInspector({ knownMints, list }: { knownMints: KnownMint[]; list: ListState }) {
  const navigate = useNavigate()
  const now = useNow()
  const [input, setInput] = useState('')
  const [result, setResult] = useState<TokenInfo | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [inspected, setInspected] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [verify, setVerify] = useState<VerifyResult | null>(null)
  // Keyset status and claim fee from the keysets the mint listed during Verify (null until it answered).
  const [feeFacts, setFeeFacts] = useState<TokenFeeFacts | null>(null)
  const [checkingSpent, setCheckingSpent] = useState(false)
  const [spentResult, setSpentResult] = useState<SpentCheckResult | null>(null)
  // When the mint was asked (for the "asked mint <host> at <time>" source lines of the Verify part).
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null)
  const [spentAt, setSpentAt] = useState<Date | null>(null)

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
  // A spent token has nothing left to claim: no Mint fee block (owner, 2026-11-28).
  const allSpent = spentResult?.status === 'ok' && classifySpentCheck(spentResult.data) === 'all-spent'
  const isTestMintToken = result !== null && isTestMint(mintInfo?.url ?? result.mint)

  // When the mint did not answer Verify, the keysets MintRadar last stored for it (kept for mints that are offline)
  // still give the fee and status; the block says so. Without them the fee stays "unknown", never guessed.
  const storedFeeFacts = useMemo(() => {
    if (verify?.status !== 'unreachable' || !mintInfo?.lastKeysets?.length) return null
    const ids = localProofKeysetIds(cleanToken)
    if (!ids) return null
    const byId = new Map(mintInfo.lastKeysets.map(k => [k.id, k]))
    return tokenFeeFacts(ids, id => {
      const k = byId.get(id)
      return k ? { active: k.active, inputFeePpk: k.inputFeePpk } : null
    })
  }, [verify, mintInfo, cleanToken])

  // Keysets the mint does not list (live answer first, else its last stored list). A token from such a
  // keyset may not come from this mint at all, so the Verify part warns before the fee and spent lines.
  const unknownIds = unknownKeysetIds(feeFacts ?? storedFeeFacts)
  const unknownFromStored = !feeFacts && unknownIds.length > 0
  const unspentSure = unspentConfidence(verify?.status ?? null, unknownIds.length > 0) === 'confirmed'
  const verdict = tokenVerdict({
    spent: spentResult, checking: checkingSpent, signaturesConfirmed: unspentSure,
    mintName: mintInfo?.name ?? (result ? getHostname(result.mint) : ''), mintHost: result ? getHostname(result.mint) : '',
    testMint: isTestMintToken,
  })
  const VerdictIcon = VERDICT_ICON[verdict.tone]

  const handleInspectAndVerify = async () => {
    const token = cleanToken
    if (!token) return
    const id = inspectGuard.current.next()
    inspectRun.current?.cancel()
    inspectRun.current = null
    setInspected(true)
    setVerify(null)
    setFeeFacts(null)
    setVerifiedAt(null)
    setSpentResult(null)
    setSpentAt(null)
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
    let facts: TokenFeeFacts | null = null
    try {
      const decoded = await run.race(decodeTokenWithMint(token, { run }))
      facts = decoded.keysets
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
    setFeeFacts(facts)
    setVerifiedAt(new Date())
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
    setSpentAt(null)
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
            // either way this must not take down the rest of the inspector UI. The library's own
            // error text is technical (network and decoder internals) and is never shown.
            outcome = { status: 'error', message: 'Could not reach the mint.' }
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
    setSpentAt(new Date())
    setCheckingSpent(false)
  }

  return (
    <div className="tool-card">
      <div className="tool-header">
        <div className="tool-title">Token inspector</div>
        <div className="tool-subtitle">Paste a Cashu token (v4 or v3) to see its mint, amount and reliability before you redeem it.</div>
      </div>

      <textarea
        className="token-input"
        placeholder="v4 token (cashuB…) or v3 token (cashuA…)"
        value={input}
        onChange={e => { invalidateRuns(); setInput(e.target.value); setInspected(false); setResult(null); setParseError(null); setVerify(null); setFeeFacts(null); setVerifiedAt(null); setPhase('idle'); setSpentResult(null); setSpentAt(null); setCheckingSpent(false) }}
        rows={3}
        spellCheck={false}
      />
      {/* 2026-11-19 redesign (phase 6c): the solid copper action with what to do beside it, the privacy line under it. */}
      <div className="tool-act">
        <button
          type="button"
          className="tool-btn-primary inspect-token-btn"
          onClick={() => void handleInspectAndVerify()}
          disabled={!cleanToken || phase !== 'idle'}
        >
          {phase === 'inspecting' ? <><Search size={14} aria-hidden="true" /> Inspecting…</>
            : phase === 'verifying' ? <><ShieldCheck size={14} aria-hidden="true" /> Verifying with mint…</>
            : 'Inspect token'}
        </button>
        {!cleanToken && <span className="token-hint">Paste a token first.</span>}
      </div>
      <p className="token-note tool-private"><Info size={14} aria-hidden="true" /><span>Decoded in your browser. Our server never sees the token; checking it contacts only the mint named in it.</span></p>

      {parseError && inspected && (
        <div className="token-error">{parseError}</div>
      )}

      {result && (
        <>
          {/* The answer first (review 2026-11-28, T1): amount, spent state and what to do, then the details below. */}
          <section className={`token-verdict tvd-${verdict.tone}`} aria-label="Result" data-testid="token-verdict" data-checked={spentResult ? "true" : "false"}>
            <VerdictIcon size={18} aria-hidden="true" className={`tvd-icon${verdict.tone === 'loading' ? ' tv-spin' : ''}`} />
            <div className="tvd-text" role="status">
              <div className="tvd-title">
                <b>{amountInUnit(result.amount, result.unit)}</b> · {verdict.title}
                {isTestMintToken && <span className="token-test-chip">Test mint</span>}
              </div>
              <div className="tvd-sub" data-testid="token-verdict-sub">{verdict.sub}</div>
            </div>
          </section>
          <div className="token-actions">
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
            {/* wallet.cashu.me reads `#token=` verbatim (cashubtc/cashu.me WalletPage.vue), so the raw token goes in the
                fragment, which browsers never send to a server. redeem.cashu.me does not pre-fill a token without a
                lightning address (cashubtc/cashu-redeem), so that link carries nothing. A spent token offers neither. */}
            {!actions.redeemDisabled && (
              <a
                className={`token-action-btn${actions.accent === 'redeem' ? ' token-action-accent' : ''}`}
                href="https://redeem.cashu.me/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Zap size={13} aria-hidden="true" /> Redeem to Lightning
              </a>
            )}
            {actions.showOpenInWallet && (
              <a className="token-action-btn" href={`https://wallet.cashu.me/#token=${cleanToken}`} target="_blank" rel="noopener noreferrer">
                Open in cashu.me <ExternalLink size={12} aria-hidden="true" />
              </a>
            )}
            {mintInfo && (
              <button type="button" className="token-action-btn" onClick={() => navigate(`/mint/${encodeURIComponent(result.mint)}`)}>
                View Mint Detail
              </button>
            )}
          </div>
          {(spentResult && spentResult.status !== 'bad-mint-url' && spentAt) || actions.showOpenInWallet ? (
            <div className="token-source">
              {spentResult && spentResult.status !== 'bad-mint-url' && spentAt && (
                <><span data-testid="token-spent-source">Asked mint {getHostname(result.mint)} at {formatDateTimeUtc(spentAt)}</span>{'. '}</>
              )}
              {actions.showOpenInWallet && <span data-testid="token-wallet-note">Open in cashu.me puts the token in the link; the wallet may keep it in its history.</span>}
            </div>
          ) : null}

          <section className="token-part" aria-labelledby="token-decode-title" data-testid="token-decode">
          <div className="token-part-head">
            <div className="token-part-title" id="token-decode-title">Decode</div>
            <div className="token-part-sub">Read in your browser from the token itself. Nothing is sent.</div>
          </div>
          <div className="token-result-grid">
            <div className="token-result-cell">
              <div className="trc-label">Mint</div>
              <div className="trc-mint">
                {/* Icon only for a mint we track, via the same proxied MintFavicon as the Dashboard.
                    An untracked token's mint URL is attacker-chosen, so nothing is requested for it. */}
                {mintInfo && <MintFavicon url={mintInfo.url} name={mintInfo.name} iconUrl={mintInfo.iconUrl} size={36} radius={9} className="trc-mint-icon" />}
                <div className="trc-mint-text">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <div className="trc-name">{mintInfo?.name ?? getHostname(result.mint)}</div>
                {isTestMintToken && (
                  <InfoTooltip text={TEST_MINT_TEXT}>
                    <span className="token-test-mint-badge token-test-chip">Test mint</span>
                  </InfoTooltip>
                )}
              </div>
              <div className="trc-sub trc-host">{getHostname(result.mint)}</div>
                </div>
              </div>
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Amount</div>
              <div className="trc-value">{amountInUnit(result.amount, result.unit)}</div>
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Mint status</div>
              {mintInfo ? (
                <>
                  <div className="trc-value">
                    <span className="trc-dot" aria-hidden="true" style={{ background: mintInfo.online === true ? 'var(--accent)' : mintInfo.online === false ? 'var(--red)' : 'var(--text3)' }} />
                    {mintInfo.online === true ? 'Online' : mintInfo.online === false ? 'Offline' : 'Unknown'}
                  </div>
                  {mintInfo.lastCheckedAt && (
                    <div className="trc-sub">
                      checked {Math.round((now - new Date(mintInfo.lastCheckedAt).getTime()) / 60000)} min ago
                    </div>
                  )}
                </>
              ) : list === 'ready' ? (
                <div className="trc-value trc-muted">Not in database</div>
              ) : (
                <div className="trc-value trc-muted" data-testid="token-list-state">
                  {list === 'loading' ? "Looking it up in MintRadar's list…" : "MintRadar's list is not available right now."}
                </div>
              )}
            </div>
            <div className="token-result-cell">
              <div className="trc-label">Reliability Score</div>
              {isTestMintToken ? (
                <div className="trc-sub">Test mint. Ecash from it has no value.</div>
              ) : mintInfo?.reliabilityScore != null ? (
                <>
                  <div className="trc-value" style={{ color: reliabilityColor(mintInfo.reliabilityScore) }}>{mintInfo.reliabilityScore}</div>
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

          {result.keysetIds.length > 0 && (
            <div className="token-memo-row" data-testid="token-keyset-ids"><span className="tdr-label">Keyset ids</span> <span className="token-keyset-id">{result.keysetIds.join(', ')}</span></div>
          )}
          {result.conditions.length > 0 && (
            <div className="token-memo-row" data-testid="token-conditions"><span className="tdr-label">Spending conditions</span> {result.conditions.join(', ')}</div>
          )}

          {result.memo && (
            <div className="token-memo-row"><span className="tdr-label">Memo</span> {result.memo}</div>
          )}
          </section>

          <section className="token-part" aria-labelledby="token-verify-title" data-testid="token-verify-part">
          <div className="token-part-head">
            <div className="token-part-title" id="token-verify-title">Verify</div>
            <div className="token-part-sub">Asks the mint named in the token.</div>
          </div>
          <div className="token-verify">
            <div className="token-section-label">
              <span>Signature check</span>
              <InfoTooltip text={SIGNATURE_CHECK_TEXT} about="Signature check" />
            </div>
            {phase === 'verifying' && (
              <ResultNote tone="loading" Icon={LoaderCircle}>Verifying with mint… checking this token's signatures.</ResultNote>
            )}
            {verify?.status === 'valid' && (
              <ResultNote tone="ok" Icon={CircleCheck}>Verified. Every proof is signed by this mint. This doesn't show whether it's spent.</ResultNote>
            )}
            {verify?.status === 'invalid' && (
              <ResultNote tone="unknown" Icon={TriangleAlert}>The DLEQ proof does not match this mint's published keys. The token may have been altered, or the mint may be using different keys.</ResultNote>
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
            {verify && verify.status !== 'bad-mint-url' && verifiedAt && (
              <div className="token-source" data-testid="token-verify-source">Asked mint {getHostname(result.mint)} at {formatDateTimeUtc(verifiedAt)}</div>
            )}
          </div>

          {verify && verify.status !== 'bad-mint-url' && unknownIds.length > 0 && (
            <div className="token-unknown-keyset" role="alert" data-testid="token-unknown-keyset">
              <TriangleAlert size={15} aria-hidden="true" className="tv-icon" />
              <span>
                {unknownFromStored ? "The mint's last listed keysets do not include" : 'This mint does not list'}{' '}
                {unknownIds.length === 1 ? 'keyset' : 'keysets'} <span className="token-keyset-id">{unknownIds.join(', ')}</span>.
                {' '}The token may not come from this mint, or may be invalid.
              </span>
            </div>
          )}

          {verify && verify.status !== 'bad-mint-url' && !allSpent && (
            feeFacts
              ? <ClaimFee facts={feeFacts} unit={result.unit} source="mint" />
              : storedFeeFacts
                ? <ClaimFee facts={storedFeeFacts} unit={result.unit} source="stored" storedAt={mintInfo?.lastKeysetsCheckedAt ?? null} />
                : <ClaimFee facts={null} unit={result.unit} source="none" />
          )}

          {mintOffline && (
            <div className="token-note">This mint didn't answer its last check, so checking or redeeming may not work.</div>
          )}

          </section>

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

interface UnitLimits { min: number | null; max: number | null }
interface WizardRec {
  url: string
  mint: KnownMint
  score: number
  /** The weighted parts of `score` (and the software credit), for the "why #1" line (whyBestReasons). */
  parts: WizardParts
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

// Rough balance-size thresholds per unit, shown as labels only — `size` is a bucket
// key, never compared against an amount. Deliberately static and approximate (no FX
// rate); sat is the reference, the rest are ballpark equivalents. A unit not listed
// here gets no threshold hint rather than a wrong one.
const SIZE_HINTS: Record<string, [string, string, string]> = {
  // In words (2026-11-19 redesign; they were "< 10k sats" in the mono face).
  sat: ['under 10,000 sat', '10,000 to 100,000 sat', 'over 100,000 sat'],
  msat: ['under about 10 million msat', 'about 10 to 100 million msat', 'over about 100 million msat'],
  eur: ['under about €10', 'about €10 to €100', 'over about €100'],
  usd: ['under about $10', 'about $10 to $100', 'over about $100'],
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
  // Task B2: a soft software preference (a family key, null = Any) and a latency limit over the browser measurements the wizard
  // already takes (null = Any). `recsCtx` is what the shown results were computed with, so their reason lines and notes do not
  // change when an option is toggled afterwards.
  const [preferredSoftware, setPreferredSoftware] = useState<string | null>(null)
  const [latencyLimit, setLatencyLimit] = useState<LatencyLimit | null>(null)
  const [recsCtx, setRecsCtx] = useState<{ checks: Set<WizardCheck>; preferred: string | null; limit: LatencyLimit | null; measured: number; total: number } | null>(null)
  const softwareOptions = useMemo(() => softwareChoices(knownMints), [knownMints])
  // After "Find my mint" the results start below the tall form (off screen on a phone), so each finished Find
  // scrolls them into view and moves focus to their heading for screen readers. Only a Find does this.
  const [findSeq, setFindSeq] = useState(0)
  const resultsRef = useRef<HTMLDivElement>(null)
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (findSeq === 0) return
    const id = requestAnimationFrame(() => {
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const el = resultsRef.current
      if (el) {
        // Just below the sticky navbar, whose height differs between phone (two rows) and desktop.
        const navBottom = document.querySelector('.navbar')?.getBoundingClientRect().bottom ?? 0
        window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - Math.max(navBottom, 0) - 12, behavior: reduce ? 'auto' : 'smooth' })
      }
      resultsHeadingRef.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [findSeq])
  const effectivePreferred = softwareOptions.some(o => o.key === preferredSoftware) ? preferredSoftware : null

  // Built from the distinct units the online mints actually advertise, never a
  // hardcoded sat/usd/eur list — a mint offering a new unit shows up here on its
  // own. Ordered like the cards and the filter (sortUnits: SAT, USD, EUR, then others).
  // TIH is left out (D-D, review 2026-11-27, owner): an unexplained unit few mints offer; MSAT stays.
  const availableUnits = useMemo(() => {
    const set = new Set<string>()
    for (const m of knownMints) {
      if (m.online !== true) continue
      for (const u of m.units ?? []) if (wizardOffersUnit(u)) set.add(u)
    }
    return sortUnits([...set])
  }, [knownMints])

  const selectedUnit = unit ?? availableUnits[0] ?? null

  const sizeHints = selectedUnit ? SIZE_HINTS[selectedUnit] : undefined

  const advancedSelected = ADVANCED_CHECKS.filter(o => checks.has(o.id)).length + (effectivePreferred !== null ? 1 : 0) + (latencyLimit !== null ? 1 : 0)

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
      // Online AND probed recently (hasFreshProbe, methodology 6), like the wallet API's eligibleForRecommendation.
      .filter(m => m.online === true && hasFreshProbe(m.lastCheckedAt) && m.reliabilityScore != null)
      // Dev/test-only mints (fake sats, "do not use as default", etc.) are
      // real and findable via Dashboard/Watchlist/Search, but the wizard is
      // an active recommendation — never suggest one as someone's mint.
      .filter(m => !isNotRecommendedMint(m))
      // Same 14-day minimum-age gate as the Reliability Score top-5 surfaces (Stats,
      // /api/stats) — a brand-new mint shouldn't be actively recommended here
      // just because it hasn't accumulated enough history to be penalized yet.
      .filter(m => isEligibleForRecommendation(m.discoveredAt))
      // And a month without long downtime (methodology 7): at least MIN_RECOMMENDATION_UPTIME_30D_PCT of the probes of
      // the last 30 days succeeded, the same rule as the wallet API's eligibleForRecommendation. The unrounded share:
      // the whole-percent uptimePct30d would let 94.5 % pass as 95 %.
      .filter(m => hasSteadyUptime(m.uptimePct30dExact))
      // A mint that doesn't issue this unit can't serve the user at all, so it
      // is dropped before scoring rather than ranked and then explained away.
      .filter(m => (m.units ?? []).includes(selectedUnit))
      // Seed restore (NUT-9), locked payments (NUT-11), WebSocket (NUT-17): the NUT must be declared
      // and not `supported: false` (passesWizardNutChecks, src/utils/nutFilters.ts).
      .filter(m => passesWizardNutChecks(m.nutsLimits, checks))
      // Lightning in + out means both mint (deposit) and melt (withdraw) support
      // bolt11/bolt12 — cardLightningLabel() only returns 'LN' when both sides do.
      .filter(m => !checks.has('ln') || cardLightningLabel(m) === 'LN')
      // Equal scores in URL order, so the same data always measures the same 20 candidates.
      .sort((a, b) => (b.reliabilityScore ?? 0) - (a.reliabilityScore ?? 0) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
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

    const scoredAll: WizardRec[] = candidates.map(m => {
      const latMs = latencyMap.get(m.url) ?? null
      const reliabilityScore = (m.reliabilityScore ?? 0) / 100
      const nutsScore = (m.nutCount ?? 0) / maxNuts
      const parts: WizardParts = {
        // Without "Fast from here" latency only breaks ties between close mints (latencyPart, LATENCY_TIE_BREAK_POINTS).
        latency: latencyPart(w, latMs, maxLatency, checks.has('fast')),
        reliability: w.reliability * reliabilityScore,
        nuts: w.nuts * nutsScore,
        reviews: w.reviews * reviewsScore(m),
        // Added by rankWizardRecs, not part of `score`; kept here only so the "why #1" line can name it.
        software: matchesPreferredSoftware(m, effectivePreferred) ? softwarePreferenceCredit(w) : 0,
      }
      return {
        url: m.url,
        mint: m,
        score: parts.latency + parts.reliability + parts.nuts + parts.reviews,
        parts,
        latencyMs: latMs,
        mintLimits: limitsForUnit(m.mintMethods ?? null, selectedUnit),
        meltLimits: limitsForUnit(m.meltMethods ?? null, selectedUnit),
      }
    })

    // Software preference (a score credit, nobody removed) and the latency limit (only measured mints under it) are applied here, after
    // the measurement the wizard always takes: choosing a limit starts no connection of its own.
    const ranking = rankWizardRecs(scoredAll, { preferred: effectivePreferred, latencyLimit, bonus: softwarePreferenceCredit(w) })

    setRecs(ranking.top)
    setRecsCtx({ checks: new Set(checks), preferred: effectivePreferred, limit: latencyLimit, measured: ranking.measured, total: ranking.total })
    setRecsUnit(selectedUnit)
    setFinding(false)
    setFindSeq(n => n + 1)
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
        {/* The chosen state has a mark of its own, not only a border and a fill (a hovered option has a border too). */}
        <span className="wizard-opt-mark" aria-hidden="true">{active && <Check size={15} strokeWidth={2.6} />}</span>
      </button>
    )
  }

  return (
    <div className="tool-card">
      {/* "Find a mint for me" with "Step N of 2" beside it and the copper bar under both (mockup alignment 2026-11-19). */}
      <div className="tool-header wizard-head">
        <div className="tool-title">Find a mint for me</div>
        <span className="wizard-step-text">Step {step} of 2</span>
      </div>
      <div className="wizard-steps">
        <div className="wizard-step-bar" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={2} aria-valuenow={step}>
          <i style={{ width: `${(step / 2) * 100}%` }} />
        </div>
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

          <div className="wizard-q">How much do you plan to keep there?</div>
          <div className="wizard-options">
            {[
              { id: 'small' as SizeOption, label: 'Small', sub: sizeHints?.[0] },
              { id: 'medium' as SizeOption, label: 'Medium', sub: sizeHints?.[1] },
              { id: 'large' as SizeOption, label: 'Large', sub: sizeHints?.[2] },
            ].map(opt => (
              <button key={opt.id} type="button" className={`wizard-opt wizard-opt-radio${size === opt.id ? ' active' : ''}`}
                onClick={() => { setSize(opt.id); setStep(2) }}>
                {/* A radio-like row (mockup alignment): the dot, the word, the amount at the right. */}
                <span className="wizard-opt-dot" aria-hidden="true" />
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
            <span className="wizard-adv-title">
              Advanced options
              {/* How many choices inside are active ("Any" does not count); shown collapsed too, so a selection is never hidden without a sign. */}
              {advancedSelected > 0 && (
                <>
                  <span className="wizard-adv-badge" aria-hidden="true" data-testid="wizard-adv-badge">{advancedSelected}</span>
                  <span className="sr-only">{advancedSelected} selected</span>
                </>
              )}
            </span>
            <ChevronDown size={16} aria-hidden="true" className="wizard-adv-chevron" />
          </button>
          {advancedOpen && (
            <div id="wizard-advanced" className="wizard-options">
              {ADVANCED_CHECKS.map(renderCheck)}
              {softwareOptions.length > 0 && (
                <div className={`wizard-opt wizard-opt-group${effectivePreferred !== null ? ' active' : ''}`}>
                  <div className="wizard-opt-label">Preferred software</div>
                  <div className="wizard-opt-sub">Mints running this software rank a little higher; the others stay in the list</div>
                  <div className="wizard-unit-seg wizard-seg-multi" role="radiogroup" aria-label="Preferred software">
                    {[{ key: null as string | null, name: 'Any' }, ...softwareOptions].map(o => (
                      <button key={o.key ?? 'any'} type="button" role="radio" aria-checked={o.key === effectivePreferred}
                        className={`wizard-unit-opt${o.key === effectivePreferred ? ' active' : ''}`}
                        onClick={() => setPreferredSoftware(o.key)}>
                        {o.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className={`wizard-opt wizard-opt-group${latencyLimit !== null ? ' active' : ''}`}>
                <div className="wizard-opt-label">Max latency</div>
                <div className="wizard-opt-sub">Measured from your browser; mints that are slower, or could not be measured, are left out</div>
                <div className="wizard-unit-seg wizard-seg-multi" role="radiogroup" aria-label="Max latency (measured from your browser)">
                  {[{ key: null as LatencyLimit | null, name: 'Any' }, ...LATENCY_LIMITS.map(l => ({ key: l as LatencyLimit | null, name: `Under ${l} ms` }))].map(o => (
                    <button key={o.key ?? 'any'} type="button" role="radio" aria-checked={o.key === latencyLimit}
                      className={`wizard-unit-opt${o.key === latencyLimit ? ' active' : ''}`}
                      onClick={() => setLatencyLimit(o.key)}>
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <button type="button" className="tool-btn-primary find-my-mint-btn" disabled={!ready || finding} onClick={() => void handleFind()}>
          {finding ? 'Measuring latency…' : 'Find my mint'}
        </button>
      )}
      {step === 2 && checks.size === 0 && <div className="wizard-hint">Pick at least one priority</div>}

      {step > 1 && !recs && (
        <button type="button" className="wizard-back-btn" onClick={() => { setStep(s => s - 1); setRecs(null) }}>
          ← Back
        </button>
      )}

      {recs !== null && (
        <div className="wizard-results" ref={resultsRef} data-testid="wizard-results">
          <h3 className="sr-only" tabIndex={-1} ref={resultsHeadingRef} data-testid="wizard-results-heading">
            {recs.length === 0 ? 'No matching mints' : `${recs.length} recommended ${recs.length === 1 ? 'mint' : 'mints'}`}
          </h3>
          {recs.length === 0 ? (
            recsCtx?.limit != null && recsCtx.total > 0
              ? <div className="wizard-no-results">{latencyLimitEmptyText(recsCtx.limit)}</div>
              : <div className="wizard-no-results">No online mint supports {recsUnit} with the options you picked. Try another currency or change your answers.</div>
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
              const reason = recsCtx ? wizardReasonText({ checks: recsCtx.checks, mint: rec.mint, latencyMs: rec.latencyMs, latencyLimit: recsCtx.limit, preferred: recsCtx.preferred }) : null
              // The latency is said once per row: the reason line already gives it when speed was asked for.
              const metaLatency = recsCtx && reasonMentionsLatency({ checks: recsCtx.checks, latencyLimit: recsCtx.limit }) ? null : rec.latencyMs
              return (
                // Mockup alignment (2026-11-19): the score as a readout, the name a link to the mint, its facts under it, and
                // "Open in Cashu.me" (owner's choice of name: it opens Cashu.me with this mint, as on Mint Detail). The row
                // itself is no longer one big link, so the button is not a control inside a link.
                <div key={rec.url} className="wizard-rec-row">
                  <span
                    className={`wizard-rec-reliability wizard-rec-readout tier-${reliabilityNum == null ? 'none' : reliabilityNum >= 70 ? 'high' : reliabilityNum >= 40 ? 'mod' : 'low'}`}
                    style={{ color: reliabilityCol }}
                    aria-label={cardReliabilityLabel(reliabilityNum)}
                  >{reliabilityNum ?? '–'}</span>
                  <div className="wizard-rec-info">
                    <Link className="wizard-rec-name" to={`/mint/${encodeURIComponent(rec.url)}`}>{mintDisplayName(rec.mint, duplicateDisplayNames)}</Link>
                    {idx === 0 && <div className="wizard-rec-reason" data-testid="wizard-why-best">{whyBestText(whyBestReasons(rec, recs[1] ?? null))}</div>}
                    {reason && <div className="wizard-rec-facts">{reason}</div>}
                    <div className="wizard-rec-meta">
                      {/* Review 2026-11-28 (W3): each fact in one piece (.nw), the line breaks only between facts. */}
                      {[
                        metaLatency != null && <span key="lat" className="nw">{metaLatency} ms from your browser</span>,
                        rec.mint.uptimePct24h != null && <span key="up" className="nw">Uptime 24 h {rec.mint.uptimePct24h}%</span>,
                        (rec.mint.reviewCount ?? 0) > 0 && rec.mint.reviewAvgRating != null && (
                          <span key="rt" className="wizard-rec-rating nw">
                            <span className="wizard-rec-star" aria-hidden="true">★</span> {rec.mint.reviewAvgRating.toFixed(1)}{' '}
                            <span className="wizard-rec-rating-n">({rec.mint.reviewCount})</span>
                          </span>
                        ),
                        lnLabel && <span key="ln" className="wizard-rec-ln nw">{lnLabel}</span>,
                      ].filter(Boolean).flatMap((el, i) => (i === 0 ? [el] : [' · ', el]))}
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
                  <a
                    className="wizard-rec-wallet"
                    href={`https://wallet.cashu.me/?mint=${encodeURIComponent(rec.url)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >Open in Cashu.me</a>
                </div>
              )
            })}
            </>
          )}
          {recsCtx?.limit != null && recsCtx.total > 0 && (
            <div className="wizard-latency-note" data-testid="wizard-latency-note">{latencyLimitNote(recsCtx.measured, recsCtx.total)}</div>
          )}
          <div className="wizard-rec-exclusion-note">Test mints are never recommended here.</div>
          {recs.length > 0 && (
            <div className="wizard-rec-note">
              Reliability Score reflects the whole mint, not this specific currency — uptime, NUT support and
              version freshness are measured per mint. Only the limits above are {recsUnit}-specific.
              Community ratings are self-published on Nostr and count only slightly toward the order.
            </div>
          )}
          <button type="button" className="wizard-start-over-btn"
            onClick={() => { setStep(1); setSize(null); setChecks(new Set()); setPreferredSoftware(null); setLatencyLimit(null); setRecs(null); setRecsCtx(null); setRecsUnit(null) }}>
            ← Start over
          </button>
        </div>
      )}
    </div>
  )
}

export default function Tools() {
  const { data: knownMintsData, isError: knownMintsError } = useKnownMints()
  const mints = knownMintsData ?? []
  const listState: ListState = knownMintsData ? 'ready' : knownMintsError ? 'error' : 'loading'

  // Deep links: #pick focuses the wizard, #token the inspector.
  // Honoured on first load and on hashchange.
  useEffect(() => {
    const applyHash = () => {
      const target = window.location.hash.replace('#', '')
      if (target !== 'pick' && target !== 'token' && target !== 'payment-request') return
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

  useDocumentMeta(ROUTE_META_BY_PATH['/tools'].title, ROUTE_META_BY_PATH['/tools'].description)

  return (
    <div className="tools-page">
      <PageHead
        title="Tools"
        srTitle="Cashu Mint Tools: Token Inspector & Best Mint Finder"
        description="Check a token before you redeem it, or find the mint that fits what you need."
      />
      <div className="tools-grid">
        <div className="tools-col">
          <div id="token" tabIndex={-1} className="tool-anchor">
            <TokenInspector knownMints={mints} list={listState} />
          </div>
          <div id="payment-request" tabIndex={-1} className="tool-anchor">
            <PaymentRequestInspector knownMints={mints} list={listState} />
          </div>
        </div>
        <div id="pick" tabIndex={-1} className="tool-anchor">
          <BestMintWizard knownMints={mints} />
        </div>
      </div>
    </div>
  )
}
