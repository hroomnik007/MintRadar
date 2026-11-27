// Mint Detail "Overview" tab: the unavailable-mint notice, About (MOTD / description), Mint info (name, version,
// server time, public key, signed health record, ToS, URLs), the network card and Get in touch.
// Extracted verbatim from MintDetail.tsx (pure refactor: same DOM, classes, inline styles, aria, titles and tooltips).
// The probe / known-mints / changes / NIP-05 queries, every derived value and the copiedContact state stay in MintDetail
// and are passed in: copiedContact is shared with the sidebar Keysets copy buttons (and survives tab switches there),
// so moving it here would change behaviour. The sidebar (score donut, units and methods, keysets, fees) and the header
// tiles (latency test) are not part of this tab: they stay mounted on every tab and remain in MintDetail.
// This component holds no state or hooks.
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { Copy, Check, AlertTriangle, Mail, AtSign, Zap, ExternalLink } from 'lucide-react'
import { njumpProfileUrl } from '@/utils/nostrLinks'
import { ChangeDate, PendingTag } from '@/components/mint/ChangeDate'
import { CopyTextButton } from '@/components/mint/CopyTextButton'
import { LoadError, LIVE_DATA_ERROR } from '@/components/LoadError'
import { MintNetworkCard } from '@/components/MintNetworkCard'
import { networkRows } from '@/utils/networkInfo'
import { formatDateTimeUtc } from '@/utils/formatDate'
import { formatTimeAgo } from '@/utils/mintFormatting'
import { clockDriftLabel, isMotdAlert } from '@/utils/mintProbeDisplay'
import { contactsNotSavedYet, CONTACTS_NOT_SAVED_TEXT } from '@/utils/mintDetailFacts'
import { LAST_SCORE_CAPTION, KEEP_WALLET_SENTENCE, TEMPORARY_SENTENCE, contactSentence, restoreSentence, type UnavailableHeadline } from '@/utils/unavailableMint'
import { HEALTH_RELAY_URL, healthPublishedLine, type HealthRecord } from '@/utils/healthRecord'
import type { InfoDates } from '@/utils/changeDates'
import type { KnownMint } from '@/hooks/useKnownMints'
import type { MintStatus } from '@/core/mint/api'

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

export interface OverviewTabProps {
  /** Tracked mint URL (marks the active entry of the URLs list). */
  url: string
  now: number
  knownMint: KnownMint | null
  /** Live probe (useMintProbe) data; undefined while loading or after an error. */
  data: MintStatus | undefined
  probeLoading: boolean
  probeError: boolean
  refetchProbe: () => Promise<unknown>
  /** Unavailable / archived mint: headline, last error, score text and contacts for the notice. */
  unavailableInfo: UnavailableHeadline | null
  lastErrorText: string | null
  scoreText: string
  supportsBackupRestore: boolean
  unavailableContacts: string[]
  /** The stored score counted a contact that is not stored (contactSentence). */
  contactListedAtLastCheck: boolean
  motd: string | undefined
  description: string | undefined
  descriptionLong: string | undefined
  infoLastSeenAt: string | null | undefined
  /** "last changed" line under the MOTD (built in MintDetail with the other change dates). */
  motdDatesLine: ReactNode
  descriptionDates: { title: string } | null
  nameDates: { title: string } | null
  /** The NIP-87 announcement facts (built in MintDetail from stored discovery data); null when the mint has none. */
  nip87Line: ReactNode
  pubkeyDates: InfoDates
  nut4Disabled: boolean
  nut5Disabled: boolean
  name: string | undefined
  /** The name the page heading shows (Mint info repeats the mint's own name only when it differs). */
  headingName: string
  version: string | undefined
  mintTime: number | undefined
  pubkey: string | undefined
  healthRecord: HealthRecord | null
  tosUrl: string | undefined
  urls: string[] | undefined
  email: string | undefined
  twitter: string | undefined
  nostr: string | undefined
  contactsAreLastSeen: boolean
  lastContactsAt: string | null | undefined
  contactSource: { method: string; info: string }[] | undefined
  /** Shared with the sidebar Keysets copy buttons: which copy icon currently shows its check mark. */
  copiedContact: string | null
  setCopiedContact: Dispatch<SetStateAction<string | null>>
}

export function OverviewTab({
  url, now, knownMint, data, probeLoading, probeError, refetchProbe,
  unavailableInfo, lastErrorText, scoreText, supportsBackupRestore, unavailableContacts, contactListedAtLastCheck,
  motd, description, descriptionLong, infoLastSeenAt, motdDatesLine, descriptionDates, nameDates, nip87Line, pubkeyDates,
  nut4Disabled, nut5Disabled, name, headingName, version, mintTime, pubkey, healthRecord, tosUrl, urls,
  email, twitter, nostr, contactsAreLastSeen, lastContactsAt, contactSource,
  copiedContact, setCopiedContact,
}: OverviewTabProps) {
  return (
    <>
        {unavailableInfo && (
          <div className="md-panel md-unavailable">
            <div className="md-ua-headline">{unavailableInfo.text}</div>
            {knownMint?.lastCheckedAt && (
              <div className="md-ua-line">Last check <span title={formatDateTimeUtc(knownMint.lastCheckedAt)}>{formatTimeAgo(new Date(knownMint.lastCheckedAt), now)}</span></div>
            )}
            {lastErrorText && <div className="md-ua-line">Last error: {lastErrorText}</div>}
            <div className="md-ua-line md-ua-score">Reliability Score {scoreText}. {LAST_SCORE_CAPTION}</div>
            <div className="md-ua-todo">
              <div className="md-panel-title">What to do with tokens from an unreachable mint</div>
              <ul className="md-ua-list">
                <li>{KEEP_WALLET_SENTENCE}</li>
                <li>{TEMPORARY_SENTENCE}</li>
                <li>{restoreSentence(supportsBackupRestore)}</li>
                <li>{contactSentence(unavailableContacts, contactListedAtLastCheck)}</li>
              </ul>
              <Link to="/learn/understanding-the-risks" className="md-ua-link">Read about the risks of using a mint</Link>
            </div>
          </div>
        )}
        {(motd || description || descriptionLong) && (
          <div className="md-panel">
            <div className="md-panel-title">About</div>
            {infoLastSeenAt && (motd || description) && (
              <div className="md-info-lastseen" data-testid="info-lastseen" style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 8 }}>
                MOTD and description last seen {formatTimeAgo(new Date(infoLastSeenAt))}
              </div>
            )}
            {motd && isMotdAlert(motd) && (
              <div
                className={`md-mint-alert${motd.trim().length <= 24 ? ' md-mint-alert--inline' : ''}`}
                role="status"
              >
                <AlertTriangle size={16} className="md-mint-alert-icon" />
                <div className="md-mint-alert-body">
                  <div className="md-mint-alert-title">Message from the operator</div>
                  <div className="md-mint-alert-text">{motd}</div>
                  {motdDatesLine}
                </div>
              </div>
            )}
            {motd && !isMotdAlert(motd) && (
              <div className="md-motd">
                <div className="md-motd-label">Message of the Day</div>
                <div className="md-motd-text">{motd}</div>
                {motdDatesLine}
              </div>
            )}
            {/* The mint's own words without labels (2026-11-19 mockup alignment): the short description as the lede, the
                long one muted under it. */}
            {description && (
              <p className="md-about-lede" title={descriptionDates?.title}>{description}</p>
            )}
            {descriptionLong && (
              <p className="md-about-more">{descriptionLong}</p>
            )}
          </div>
        )}
        <div className="md-panel">
          <div className="md-panel-title">Mint info</div>
        {probeLoading && (
          <div style={{fontSize:12,color:'var(--text3)',fontFamily:'var(--font-mono)',marginBottom:12}}>
            Loading live mint data (MOTD, description, contact)…
          </div>
        )}
        {probeError && data === undefined && <LoadError message={LIVE_DATA_ERROR} onRetry={() => { void refetchProbe() }} />}
        {(nut4Disabled || nut5Disabled) && (
          <div className="md-mint-alert">
            <AlertTriangle size={16} className="md-mint-alert-icon" />
            <div className="md-mint-alert-body">
              {nut4Disabled && (
                <>
                  <div className="md-mint-alert-title">This mint has stopped issuing new ecash</div>
                  <div className="md-mint-alert-text">
                    You can no longer deposit here, but any ecash you already hold can still
                    be melted or withdrawn. A mint turning off minting usually means the
                    operator is winding it down — if you have a balance on this mint,
                    withdraw it while you still can.
                  </div>
                </>
              )}
              {nut5Disabled && (
                <>
                  <div className="md-mint-alert-title">This mint has disabled withdrawals</div>
                  <div className="md-mint-alert-text">
                    Melting ecash back to Lightning is switched off right now. Funds already
                    held on this mint can&apos;t be moved out until the operator re-enables it —
                    avoid depositing more here in the meantime.
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        <div className="md-info-grid md-info-list">
          {/* The name is the page heading; it stays here only when the mint's own name differs from what the heading shows. */}
          {name && name !== headingName && (
            <div className="md-info-row">
              <span className="md-info-label">Name</span>
              <span className="md-info-value" title={nameDates?.title}>{name}</span>
            </div>
          )}
          <div className="md-info-row">
            <span className="md-info-label">Version</span>
            <span className="md-info-value md-info-code">{version ?? '—'}</span>
          </div>
          {/* "Found through" (2026-11-19 mockup alignment): how MintRadar found the mint and its announcement in one row
              (they were "Discovered" and "Nostr announcement"). */}
          <div className="md-info-row md-info-row-nip87">
            <span className="md-info-label">Found through</span>
            <span className="md-info-value">{nip87Line ?? 'NIP-87'}</span>
          </div>
          {mintTime && (
            <div className="md-info-row">
              <span className="md-info-label">Server time</span>
              <span className="md-info-value" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                {formatTime(new Date(mintTime * 1000))}
                {(() => { const d = clockDriftLabel(mintTime); return <span className="md-clock-drift" style={d.label === 'in sync' ? undefined : { color: d.color }} title="Mint clock vs this browser">{d.label === 'in sync' ? 'in sync with ours' : `${d.label} from ours`}</span> })()}
              </span>
            </div>
          )}
          {pubkey && (
            <div className="md-info-row" style={{alignItems: 'center'}}>
              <span className="md-info-label">Public key</span>
              <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
                <span style={{fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-mono)'}}>{pubkey.slice(0, 8)}…{pubkey.slice(-8)}</span>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(pubkey)
                    setCopiedContact('pubkey')
                    setTimeout(() => setCopiedContact(null), 2000)
                  }}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: copiedContact === 'pubkey' ? 'var(--accent)' : 'var(--text3)',
                    padding: '2px 4px', flexShrink: 0, display: 'flex',
                  }}
                  className="md-copy-icon"
                title="Copy full public key"
                  aria-label="Copy full public key"
                >
                  {copiedContact === 'pubkey' ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              {(pubkeyDates.changed || pubkeyDates.pending) && (
                <div className="md-info-dates" data-testid="pubkey-dates">
                  {pubkeyDates.changed && <ChangeDate prefix="since" mark={pubkeyDates.changed} testId="pubkey-since" />}
                  {pubkeyDates.pending && <PendingTag mark={pubkeyDates.pending} />}
                </div>
              )}
            </div>
          )}
          <div className="md-hr-block">
            <div className="md-info-row md-hr-row">
              <span className="md-info-label">Signed health record</span>
              {(() => {
                const published = healthRecord ? healthPublishedLine(knownMint?.healthRecordPublishedAt, now) : null
                if (!healthRecord) return <span className="md-info-value md-hr-published">No current record</span>
                return published ? <span className="md-info-value md-hr-published" data-testid="hr-published">{published.text}</span> : null
              })()}
            </div>
            <div className="md-hr-actions">
              {healthRecord?.njumpUrl && (
                <a
                  href={healthRecord.njumpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="md-hr-view"
                  aria-label="View on Nostr (opens njump.me, an external site, in a new tab)"
                >View on Nostr<ExternalLink size={12} aria-hidden="true" /></a>
              )}
              <Link to="/for-wallets#signed-health-assertions" className="md-hr-link">About signed health records</Link>
            </div>
            {healthRecord && (
              <details className="md-hr-dev">
                <summary>For developers</summary>
                <div className="md-hr-dev-body">
                  <div className="md-hr-dev-relay">Relay <code>{HEALTH_RELAY_URL}</code></div>
                  <div className="md-hr-dev-actions">
                    <CopyTextButton label="Copy naddr" what="the Nostr address (naddr) of the signed health record" value={healthRecord.naddr} />
                    <CopyTextButton label="Copy nak command" what="a nak command that fetches the signed health record" value={healthRecord.nakCommand} />
                  </div>
                  <p className="md-hr-dev-note">Requires the nak command-line tool (<a href="https://github.com/fiatjaf/nak" target="_blank" rel="noopener noreferrer">github.com/fiatjaf/nak</a>).</p>
                </div>
              </details>
            )}
          </div>
          {tosUrl && (tosUrl.startsWith('https://') || tosUrl.startsWith('http://')) && (
            <div className="md-info-row">
              <span className="md-info-label">Terms of service</span>
              <a
                href={tosUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="md-info-value"
                onClick={e => e.stopPropagation()}
              >
                Read the terms
              </a>
            </div>
          )}
        </div>
        {urls && urls.length > 1 && (
          <div className="md-info-row" style={{flexDirection:'column', alignItems:'flex-start', gap:4}}>
            <span className="md-info-label">URLs</span>
            <div style={{display:'flex', flexDirection:'column', gap:3, width:'100%'}}>
              {urls.map((u: string) => {
                const isActive = u === url
                return (
                  <div key={u} style={{display:'flex', alignItems:'center', gap:6, justifyContent:'space-between'}}>
                    <span style={{
                      fontSize:12, color: isActive ? 'var(--accent)' : 'var(--text3)',
                      fontFamily:'var(--font-mono)', wordBreak:'break-all', flex:1
                    }}>
                      {isActive ? '● ' : '○ '}{u}
                    </span>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(u)
                        setCopiedContact(`url-${u}`)
                        setTimeout(() => setCopiedContact(null), 2000)
                      }}
                      style={{
                        background:'none', border:'none', cursor:'pointer',
                        color: copiedContact === `url-${u}` ? 'var(--accent)' : 'var(--text3)', padding:'2px 4px',
                        flexShrink:0, display:'flex',
                      }}
                      className="md-copy-icon md-copy-icon--stack"
                      title="Copy URL"
                      aria-label="Copy URL"
                    >
                      {copiedContact === `url-${u}` ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {(() => { const rows = networkRows(knownMint); return rows ? <MintNetworkCard rows={rows} /> : null })()}

      {/* The operator's NIP-05 line and the Contact checks line are gone (owner, 2026-11-27): the checks are in the ⓘ of the
          Contact row of "How the N is made", where they explain the points. */}
      {(email || twitter || nostr || contactsNotSavedYet(data?.contactChecks, contactSource?.length ?? 0)) && (
        <div className="md-panel">
          {(email || twitter || nostr) && (
            <>
              <div className="md-panel-title">Get in touch</div>
              {contactsAreLastSeen && lastContactsAt && (
                <div className="md-contact-lastseen" style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 8 }}>
                  last seen {formatTimeAgo(new Date(lastContactsAt))}
                </div>
              )}
              <div className="md-contact-grid">
                {email && (
                  <div className="md-contact-card">
                    <div className="md-contact-icon"><Mail size={14} /></div>
                    <div style={{minWidth:0}}>
                      <div className="md-contact-type">Email</div>
                      <div className="md-contact-val">{email}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard.writeText(email)
                        setCopiedContact('email')
                        setTimeout(() => setCopiedContact(null), 2000)
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copiedContact === 'email' ? 'var(--accent)' : 'var(--text3)',
                        padding: '2px 4px', marginLeft: 'auto',
                        flexShrink: 0, display: 'flex',
                      }}
                      className="md-copy-icon"
                      title="Copy"
                      aria-label="Copy"
                    >
                      {copiedContact === 'email' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {twitter && (
                  <div className="md-contact-card">
                    <div className="md-contact-icon"><AtSign size={14} /></div>
                    <div style={{minWidth:0}}>
                      <div className="md-contact-type">Twitter</div>
                      <div className="md-contact-val">{twitter}</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard.writeText(twitter)
                        setCopiedContact('twitter')
                        setTimeout(() => setCopiedContact(null), 2000)
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copiedContact === 'twitter' ? 'var(--accent)' : 'var(--text3)',
                        padding: '2px 4px', marginLeft: 'auto',
                        flexShrink: 0, display: 'flex',
                      }}
                      className="md-copy-icon"
                      title="Copy"
                      aria-label="Copy"
                    >
                      {copiedContact === 'twitter' ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
                {nostr && (
                  <div className="md-contact-card">
                    <div className="md-contact-icon"><Zap size={14} /></div>
                    <div style={{minWidth:0}}>
                      <div className="md-contact-type">Nostr</div>
                      <div className="md-contact-val" style={{wordBreak:'break-all'}}>
                        {njumpProfileUrl(nostr) ? (
                          <a href={njumpProfileUrl(nostr)!} target="_blank" rel="noopener noreferrer">{nostr}</a>
                        ) : <>{nostr}<span className="md-contact-unrecognised"> · format not recognised</span></>}
                      </div>
                    </div>
                    {/* N6 (review 2026-11-27): a value that is not a Nostr key (Minibits lists the placeholder "npub…")
                        gets no copy button; the wording is the Contact checks line's own (contactChecks.ts). */}
                    {njumpProfileUrl(nostr) && <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void navigator.clipboard.writeText(nostr)
                        setCopiedContact('nostr')
                        setTimeout(() => setCopiedContact(null), 2000)
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: copiedContact === 'nostr' ? 'var(--accent)' : 'var(--text3)',
                        padding: '2px 4px', marginLeft: 'auto',
                        flexShrink: 0, display: 'flex',
                      }}
                      className="md-copy-icon"
                      title="Copy"
                      aria-label="Copy"
                    >
                      {copiedContact === 'nostr' ? <Check size={13} /> : <Copy size={13} />}
                    </button>}
                  </div>
                )}
              </div>
            </>
          )}
          {contactsNotSavedYet(data?.contactChecks, contactSource?.length ?? 0) && (
            <>
              <div className="md-panel-title">Get in touch</div>
              <div className="md-contact-notsaved" data-testid="contacts-not-saved" style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>{CONTACTS_NOT_SAVED_TEXT}</div>
            </>
          )}
        </div>
      )}
    </>
  )
}
