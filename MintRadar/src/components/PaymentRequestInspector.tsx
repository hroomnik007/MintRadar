import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { InfoTooltip } from '@/components/InfoTooltip'
import { revealResult } from '@/utils/revealResult'
import { PAYMENT_REQUEST_PRIVACY_TEXT, TEST_MINT_TEXT } from '@/utils/tooltipTexts'
import type { KnownMint } from '@/hooks/useKnownMints'
import { CopyTextButton } from '@/components/mint/CopyTextButton'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { IcShield } from '@/components/mint/IcShield'
import { formatTokenAmount, amountCarriesCurrencySymbol } from '@/utils/cashuToken'
import { normalizeMintUrl, displayName, cardReliabilityLabel, reliabilityColor, statusDotColor, mintHostname } from '@/utils/mintFormatting'
import { isTestMint } from '@/constants/testMints'
import { parsePaymentRequest, bitcoinLinkNote, mintStatusWord, transportTagLines, mintListType, mintListTypeText, type PaymentRequestView } from '@/utils/paymentRequest'

// Review 2026-11-28, second pass (owner-approved mockup ~/Claude/refs/mintradar-inspectors-mockup-1128, R1-R5): a
// summary card on top like the token's (amount large, the description, one sentence about who may pay how), the rows
// under it without the amount and description again, "Accepted mints · only these", plain words for the lock and the
// transports, every mint with its picture and its host.
const NOT_SPECIFIED = 'Not specified'
const OPEN_AMOUNT = 'Open amount: the sender chooses how much to send.'
/** The Single use value of a one-shot request (2026-11-28: the separate "One-shot" note joined the row). */
const ONE_SHOT = 'Yes, can be paid only once'
// NUT-18: the per-method fee applies only to ecash from a mint outside the list (or from any mint if there is no list);
// the payer owes the lowest fee among the listed methods that its mint supports.
const OTHER_MINTS_NOTE = 'A fee applies only to ecash from a mint outside the accepted mints list, or from any mint if no list is given. The payer owes the lowest fee among the listed methods its mint supports.'
// NUT-18: with a strict list the sender MUST only send proofs from the listed mints, so the fee (which concerns mints outside the list) does not apply.
// The list type itself is the "Mint list: strict" sentence under the mints, so this note only adds the fee consequence.
const STRICT_LIST_NOTE = 'Because the mint list is strict, this fee does not apply.'
const NO_TRANSPORTS = 'Give it to the requester directly. The request names no Nostr or HTTP address.'

/** The sentence under the amount: which mints' ecash it takes, whether once only, whether locked. */
function summaryLine(view: PaymentRequestView, nameOf: (url: string) => string): string {
  const n = view.mints.length
  const type = mintListType(view)
  const mints = n === 0
    ? 'Ecash from any mint.'
    : type === 'preferred'
      ? (n === 1 ? `Prefers ecash from ${nameOf(view.mints[0]!)}; other mints are accepted too.` : `Prefers ecash from these ${n} mints; other mints are accepted too.`)
      : (n === 1 ? `Only ecash from ${nameOf(view.mints[0]!)}.` : `Only ecash from these ${n} mints.`)
  return [mints, view.singleUse === true ? 'Can be paid once.' : null, view.lock ? `Locked to a key (${view.lock.kind}).` : null].filter(Boolean).join(' ')
}

function amountText(view: PaymentRequestView): string {
  if (view.amount === null) return NOT_SPECIFIED
  const n = Number(view.amount)
  if (!view.unit || !Number.isSafeInteger(n)) return view.amount
  // With its unit (2026-11-28, the separate Unit row is gone): "100 sat", "$1.00".
  return amountCarriesCurrencySymbol(view.unit) ? formatTokenAmount(n, view.unit) : `${formatTokenAmount(n, view.unit)} ${view.unit}`
}

function methodText(m: { method: string; fee: bigint | null }, unit: string | null): string {
  if (m.fee === null || m.fee === 0n) return `${m.method} · no extra fee`
  const n = Number(m.fee)
  const fee = unit && Number.isSafeInteger(n) ? formatTokenAmount(n, unit) : m.fee.toString()
  return `${m.method} · fee ${fee}${unit ? ` ${unit}` : ''}`
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="pr-row" data-testid={testId}>
      <dt className="pr-label">{label}</dt>
      <dd className="pr-value">{children}</dd>
    </div>
  )
}

/** `list`: the known-mints list is still loading or could not be loaded; nothing is claimed about the mint then. */
function AcceptedMint({ url, known, list }: { url: string; known: KnownMint | null; list: 'ready' | 'loading' | 'error' }) {
  // Always a picture (owner, 2026-11-28): the proxied icon for a mint we track, else its initials built locally; a
  // request's mint URL is chosen by whoever made it, so nothing is requested for an untracked one.
  const host = mintHostname(url)
  const icon = <MintFavicon url={known?.url ?? url} name={known ? displayName(known) : host} iconUrl={known ? known.iconUrl : null} size={32} radius={8} className="pr-mint-icon" />
  if (!known && list !== 'ready') {
    return (
      <li className="pr-mint pr-mint-pic" data-testid="pr-mint">
        {icon}
        <div className="pr-mint-body">
        <div className="pr-mint-name">{host}</div>
        <div className="pr-text">{url}</div>
        <div className="pr-mint-line pr-muted" data-testid="pr-mint-list-state">
          {list === 'loading' ? "Looking it up in MintRadar's list…" : "MintRadar's list could not be loaded, so this mint is not looked up."}
        </div>
        </div>
      </li>
    )
  }
  if (!known) {
    return (
      <li className="pr-mint pr-mint-pic" data-testid="pr-mint">
        {icon}
        <div className="pr-mint-body">
          <div className="pr-mint-name">{host}</div>
          <div className="pr-text">{url}</div>
          <div className="pr-mint-line pr-muted">Not tracked by MintRadar.</div>
        </div>
      </li>
    )
  }
  const test = isTestMint(known.url)
  const status = mintStatusWord(known)
  return (
    <li className="pr-mint pr-mint-pic" data-testid="pr-mint">
      {icon}
      <div className="pr-mint-body">
      <div className="pr-mint-head">
        <span className="pr-mint-name">{displayName(known)}</span>
        {test && (
          <InfoTooltip text={TEST_MINT_TEXT}>
            <span className="token-test-chip pr-test-chip">Test mint</span>
          </InfoTooltip>
        )}
        <span className="pr-mint-status" data-testid="pr-mint-status">
          <span className="pr-mint-dot" data-testid="pr-mint-dot" style={{ background: statusDotColor(status) }} aria-hidden="true" />
          {status}
        </span>
      </div>
      <div className="pr-mint-line">
        <span className="pr-host">{host}</span>
        {test ? null : known.reliabilityScore != null ? (
          <span className="pr-score" style={{ color: reliabilityColor(known.reliabilityScore) }}>
            <IcShield size={12} /><span>{cardReliabilityLabel(known.reliabilityScore)}</span>
          </span>
        ) : (
          <span className="pr-muted">{cardReliabilityLabel(null)}</span>
        )}
        <Link className="pr-link" to={`/mint/${encodeURIComponent(known.url)}`}>View Mint Detail</Link>
      </div>
      </div>
    </li>
  )
}

/**
 * Payment request inspector (NUT-18 creqA, NUT-26 creqB, or a bitcoin: link containing one). The pasted string is decoded in the browser and kept only in React
 * state: no request is made for it. Targets and mint URLs are shown as text (a transport target is chosen by whoever
 * made the request), mints are matched against the known-mints list the page already loaded.
 */
export function PaymentRequestInspector({ knownMints, list }: { knownMints: KnownMint[]; list: 'ready' | 'loading' | 'error' }) {
  const [input, setInput] = useState('')
  const parsed = useMemo(() => parsePaymentRequest(input), [input])
  // A paste moves the page to its answer (owner, 2026-11-28): the summary, or the error. Typing does not.
  const cardRef = useRef<HTMLDivElement | null>(null)
  const revealPending = useRef(false)
  useEffect(() => {
    if (!revealPending.current) return
    revealPending.current = false
    requestAnimationFrame(() => revealResult(cardRef.current?.querySelector('[data-testid="pr-summary"], [data-testid="pr-error"]') ?? null))
  }, [parsed])
  const knownMap = useMemo(() => new Map(knownMints.map(m => [m.url, m] as const)), [knownMints])
  const lookup = (url: string): KnownMint | null => knownMap.get(normalizeMintUrl(url)) ?? knownMap.get(url) ?? null

  return (
    <div className="tool-card" data-testid="payment-request-inspector" ref={cardRef}>
      <div className="tool-header">
        <div className="tool-title">Payment request inspector<InfoTooltip label="Where the payment request goes" text={PAYMENT_REQUEST_PRIVACY_TEXT} iconSize={13} width={260} /></div>
        <div className="tool-subtitle">Paste a Cashu payment request (NUT-18 creqA, NUT-26 creqB or a bitcoin: link that contains one) to read what it asks for and which mints it accepts.</div>
      </div>

      <textarea
        className="pr-input"
        aria-label="Payment request"
        placeholder="creqA…, creqB… or bitcoin:?creq=…"
        value={input}
        onChange={e => setInput(e.target.value)}
        onPaste={() => { revealPending.current = true }}
        rows={3}
        spellCheck={false}
        autoComplete="off"
      />
      {parsed.ok === false && parsed.reason === 'empty' && <div className="pr-hint">Paste a payment request first.</div>}
      {parsed.ok && parsed.link && <div className="pr-note" data-testid="pr-link-note">{bitcoinLinkNote(parsed.link)}</div>}

      {parsed.ok === false && parsed.reason !== 'empty' && (
        <div className="pr-error" role="status" data-testid="pr-error">{parsed.message}</div>
      )}

      {parsed.ok && (
        <div className="pr-result" data-testid="pr-result">
          {/* R2: what the request asks for at a glance, like the token's result card. */}
          <section className="pr-summary" aria-label="Summary" data-testid="pr-summary">
            <div className="tvd-top">
              <span className="tvd-amount" data-testid="pr-amount">
                {parsed.view.amount === null ? 'Any amount' : (() => {
                  const text = amountText(parsed.view)
                  const unit = parsed.view.unit
                  return unit && !amountCarriesCurrencySymbol(unit) && text.endsWith(` ${unit}`)
                    ? <>{text.slice(0, -unit.length - 1)}<small> {unit}</small></>
                    : text
                })()}
              </span>
              {parsed.view.description && <span className="pr-summary-what" data-testid="pr-description">· {parsed.view.description}</span>}
            </div>
            <p className="pr-summary-line" data-testid="pr-summary-line">{summaryLine(parsed.view, u => { const k = lookup(u); return k ? displayName(k) : mintHostname(u) })}</p>
          </section>
          {parsed.view.amount === null && <div className="pr-note" data-testid="pr-open-amount">{OPEN_AMOUNT}</div>}
          <dl className="pr-dl">
            {parsed.view.amount === null && <Row label="Unit">{parsed.view.unit ?? NOT_SPECIFIED}</Row>}
            {!parsed.view.description && <Row label="Description">{NOT_SPECIFIED}</Row>}
            <Row label="Single use" testId="pr-single-use">{parsed.view.singleUse === true ? ONE_SHOT : NOT_SPECIFIED}</Row>
            <Row label="Request id">{parsed.view.id ?? NOT_SPECIFIED}</Row>
            <Row label="Locked to a key" testId="pr-lock">
              {parsed.view.lock ? (
                <>
                  <div>Yes, {parsed.view.lock.kind}</div>
                  <div className="pr-text">{parsed.view.lock.data}</div>
                  {parsed.view.lock.tags.map((t, i) => <div className="pr-text" key={i}>{t}</div>)}
                </>
              ) : 'No'}
            </Row>
          </dl>

          <div className="pr-section">
            Accepted mints{parsed.view.mints.length > 1 ? ` (${parsed.view.mints.length})` : ''}
            {mintListTypeText(parsed.view) !== null && <span className="pr-section-note" data-testid="pr-mint-list-type"> · {mintListTypeText(parsed.view)}</span>}
          </div>
          {parsed.view.mints.length === 0 ? (
            <div className="pr-note" data-testid="pr-no-mints">No mints specified</div>
          ) : (
          <ul className="pr-list">
            {parsed.view.mints.map((m, i) => <AcceptedMint key={`${i}-${m}`} url={m} known={lookup(m)} list={list} />)}
          </ul>
          )}

          {parsed.view.supportedMethods !== null && parsed.view.supportedMethods.length > 0 && (
            <>
              <div className="pr-section">Other mints</div>
              <ul className="pr-list" data-testid="pr-methods">
                {parsed.view.supportedMethods.map((m, i) => (
                  <li className="pr-method" key={`${i}-${m.method}`} data-testid="pr-method">{methodText(m, parsed.view.unit)}</li>
                ))}
              </ul>
              <div className="pr-note" data-testid="pr-methods-note">{OTHER_MINTS_NOTE}</div>
              {mintListType(parsed.view) === 'strict' && (
                <div className="pr-note" data-testid="pr-methods-strict">{STRICT_LIST_NOTE}</div>
              )}
            </>
          )}

          <div className="pr-section">Where to send the payment</div>
          {parsed.view.transports.length === 0 ? (
            <div className="pr-note" data-testid="pr-no-transports">{NO_TRANSPORTS}</div>
          ) : (
            <ul className="pr-list">
              {parsed.view.transports.map((t, i) => {
                const { nips, lines } = transportTagLines(t.tags)
                return (
                  <li className="pr-transport" key={`${i}-${t.target}`} data-testid="pr-transport">
                    <div className="pr-transport-type" data-testid="pr-transport-type">{t.type}{nips !== null && <span className="pr-transport-nips">{` · NIPs: ${nips}`}</span>}</div>
                    <div className="pr-text" data-testid="pr-transport-target">{t.target}</div>
                    {lines.map((l, j) => <div className="pr-text" key={j} data-testid="pr-transport-tag">{l}</div>)}
                    <CopyTextButton label="Copy" what={`${t.type} transport target`} value={t.target} />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
