import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { KnownMint } from '@/hooks/useKnownMints'
import { CopyTextButton } from '@/components/mint/CopyTextButton'
import { IcShield } from '@/components/mint/IcShield'
import { formatTokenAmount } from '@/utils/cashuToken'
import { normalizeMintUrl, displayName, cardReliabilityLabel, reliabilityColor, statusDotColor } from '@/utils/mintFormatting'
import { isTestMint } from '@/constants/testMints'
import { parsePaymentRequest, mintStatusWord, transportTagLines, mintListType, mintListTypeText, type PaymentRequestView } from '@/utils/paymentRequest'

const NOT_SPECIFIED = 'Not specified'
const OPEN_AMOUNT = 'Open amount: the sender chooses how much to send.'
const ONE_SHOT = 'One-shot: this request can be paid only once.'
// NUT-18: the per-method fee applies only to ecash from a mint outside the list (or from any mint if there is no list);
// the payer owes the lowest fee among the listed methods that its mint supports.
const OTHER_MINTS_NOTE = 'A fee applies only to ecash from a mint outside the accepted mints list, or from any mint if no list is given. The payer owes the lowest fee among the listed methods its mint supports.'
// NUT-18: with a strict list the sender MUST only send proofs from the listed mints, so the fee (which concerns mints outside the list) does not apply.
// The list type itself is the "Mint list: strict" sentence under the mints, so this note only adds the fee consequence.
const STRICT_LIST_NOTE = 'Because the mint list is strict, this fee does not apply.'
const NO_TRANSPORTS = 'None listed: the payment is returned directly (in-band)'

function amountText(view: PaymentRequestView): string {
  if (view.amount === null) return NOT_SPECIFIED
  const n = Number(view.amount)
  if (!view.unit || !Number.isSafeInteger(n)) return view.amount
  return formatTokenAmount(n, view.unit)
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
  if (!known && list !== 'ready') {
    return (
      <li className="pr-mint" data-testid="pr-mint">
        <div className="pr-text">{url}</div>
        <div className="pr-mint-line pr-muted" data-testid="pr-mint-list-state">
          {list === 'loading' ? "Looking it up in MintRadar's list…" : "MintRadar's list could not be loaded, so this mint is not looked up."}
        </div>
      </li>
    )
  }
  if (!known) {
    return (
      <li className="pr-mint" data-testid="pr-mint">
        <div className="pr-text">{url}</div>
        <div className="pr-mint-line pr-muted">Not tracked by MintRadar.</div>
      </li>
    )
  }
  const test = isTestMint(known.url)
  const status = mintStatusWord(known)
  return (
    <li className="pr-mint" data-testid="pr-mint">
      <div className="pr-mint-head">
        <span className="pr-mint-name">{displayName(known)}</span>
        <span className="pr-mint-status" data-testid="pr-mint-status">
          <span className="pr-mint-dot" data-testid="pr-mint-dot" style={{ background: statusDotColor(status) }} aria-hidden="true" />
          {status}
        </span>
      </div>
      <div className="pr-text">{url}</div>
      <div className="pr-mint-line">
        {test ? (
          <span className="pr-muted">Test mint. Ecash from it has no value.</span>
        ) : known.reliabilityScore != null ? (
          <span className="pr-score" style={{ color: reliabilityColor(known.reliabilityScore) }}>
            <IcShield size={12} /><span>{cardReliabilityLabel(known.reliabilityScore)}</span>
          </span>
        ) : (
          <span className="pr-muted">{cardReliabilityLabel(null)}</span>
        )}
        <Link className="pr-link" to={`/mint/${encodeURIComponent(known.url)}`}>View Mint Detail</Link>
      </div>
    </li>
  )
}

/**
 * Payment request inspector (NUT-18 creqA, NUT-26 creqB). The pasted string is decoded in the browser and kept only in React
 * state: no request is made for it. Targets and mint URLs are shown as text (a transport target is chosen by whoever
 * made the request), mints are matched against the known-mints list the page already loaded.
 */
export function PaymentRequestInspector({ knownMints, list }: { knownMints: KnownMint[]; list: 'ready' | 'loading' | 'error' }) {
  const [input, setInput] = useState('')
  const parsed = useMemo(() => parsePaymentRequest(input), [input])
  const knownMap = useMemo(() => new Map(knownMints.map(m => [m.url, m] as const)), [knownMints])
  const lookup = (url: string): KnownMint | null => knownMap.get(normalizeMintUrl(url)) ?? knownMap.get(url) ?? null

  return (
    <div className="tool-card" data-testid="payment-request-inspector">
      <div className="tool-header">
        <div className="tool-title">Payment request inspector</div>
        <div className="tool-subtitle">Paste a Cashu payment request (NUT-18 creqA or NUT-26 creqB) to read what it asks for and which mints it accepts.</div>
      </div>

      <textarea
        className="pr-input"
        aria-label="Payment request"
        placeholder="creqA… or creqB…"
        value={input}
        onChange={e => setInput(e.target.value)}
        rows={3}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="pr-note">Decoded in your browser; nothing you paste here is sent anywhere.</div>

      {parsed.ok === false && parsed.reason === 'empty' && <div className="pr-hint">Paste a payment request first</div>}
      {parsed.ok === false && parsed.reason !== 'empty' && (
        <div className="pr-error" role="status" data-testid="pr-error">{parsed.message}</div>
      )}

      {parsed.ok && (
        <div className="pr-result" data-testid="pr-result">
          <dl className="pr-dl">
            <Row label="Request id">{parsed.view.id ?? NOT_SPECIFIED}</Row>
            <Row label="Amount" testId="pr-amount">{amountText(parsed.view)}</Row>
            <Row label="Unit">{parsed.view.unit ?? NOT_SPECIFIED}</Row>
            <Row label="Single use">{parsed.view.singleUse === true ? 'Yes' : NOT_SPECIFIED}</Row>
            <Row label="Description">{parsed.view.description ?? NOT_SPECIFIED}</Row>
            <Row label="Locking condition (NUT-10)" testId="pr-lock">
              {parsed.view.lock ? (
                <>
                  <div>{parsed.view.lock.kind}</div>
                  <div className="pr-text">{parsed.view.lock.data}</div>
                  {parsed.view.lock.tags.map((t, i) => <div className="pr-text" key={i}>{t}</div>)}
                </>
              ) : NOT_SPECIFIED}
            </Row>
          </dl>
          {parsed.view.amount === null && <div className="pr-note" data-testid="pr-open-amount">{OPEN_AMOUNT}</div>}
          {parsed.view.singleUse === true && <div className="pr-note" data-testid="pr-one-shot">{ONE_SHOT}</div>}

          <div className="pr-section">Accepted mints{parsed.view.mints.length > 0 ? ` (${parsed.view.mints.length})` : ''}</div>
          {parsed.view.mints.length === 0 ? (
            <div className="pr-note" data-testid="pr-no-mints">No mints specified</div>
          ) : (
          <ul className="pr-list">
            {parsed.view.mints.map((m, i) => <AcceptedMint key={`${i}-${m}`} url={m} known={lookup(m)} list={list} />)}
          </ul>
          )}
          {mintListTypeText(parsed.view) !== null && (
            <div className="pr-note" data-testid="pr-mint-list-type">{mintListTypeText(parsed.view)}</div>
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

          <div className="pr-section">Transports</div>
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
