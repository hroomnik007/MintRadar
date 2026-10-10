import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db'
import { useUserRelays } from '@/hooks/useUserRelays'
import { setNotifyFlag, type NotifyFailure, type NotifyField } from '@/core/nostr/notificationSubscription'
import { confirmedNotify, confirmedMoreNotify } from '@/utils/notifyState'

type Field = NotifyField

const FAILURE_TEXT: Record<NotifyFailure, string | null> = {
  'signer-unavailable': 'No signer available. Log in again.',
  'signer-declined': 'Signer declined the request.',
  'signer-timeout': "Signer didn't respond. Try again.",
  unreachable: "Couldn't reach the server. Try again.",
  'rate-limited': 'Too many requests. Try again later.',
  limit: 'Notification limit reached (50 mints).',
  rejected: null, // generic message below
}

const IcBell = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 1.2C4.6 1.2 3.5 2.4 3.5 3.9V5.6C3.5 6.3 3.2 6.9 2.8 7.3H9.2C8.8 6.9 8.5 6.3 8.5 5.6V3.9C8.5 2.4 7.4 1.2 6 1.2Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    <path d="M5 9.2C5.2 9.8 5.6 10.1 6 10.1C6.4 10.1 6.8 9.8 7 9.2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
  </svg>
)
const IcCheck = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M1.8 5.3L4 7.5L8.2 2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// Watchlist-card footer: "NOTIFY" + two toggle pills, plus three "More alerts" pills of the same kind. A pill is on only when the server confirmed
// it (confirmedNotify); a press is pending until the server answers and never shows "on" early.
export function NotifyStrip({ mintUrl, name }: { mintUrl: string; name: string }) {
  const { read: userReadRelays } = useUserRelays()
  const entry = useLiveQuery(() => db.watchlist.get(mintUrl), [mintUrl])
  const [pending, setPending] = useState<Field | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // Synchronous guard: a second click in the same tick (before React re-renders `pending`) is dropped.
  const busy = useRef(false)

  if (!entry) return null
  const state = confirmedNotify(entry)
  const more = confirmedMoreNotify(entry)
  const isOn: Record<Field, boolean> = {
    notifyOnDown: state.down,
    notifyOnUp: state.up,
    notifyOnMintMeltIssues: more.mintMelt,
    notifyOnVersionOutdated: more.versionOutdated,
    notifyOnNutLoss: more.nutLoss,
  }

  const press = (field: Field) => {
    if (busy.current) return
    busy.current = true
    setPending(field)
    const turningOn = !isOn[field]
    void setNotifyFlag(mintUrl, field, turningOn, userReadRelays).then(result => {
      if (result.ok) setError(null)
      else setError(FAILURE_TEXT[result.reason] ?? `Couldn't turn ${turningOn ? 'on' : 'off'} notifications. Try again.`)
    }).finally(() => {
      busy.current = false
      setPending(null)
    })
  }

  const pill = (field: Field, on: boolean, text: string, label: string) => (
    <button
      type="button"
      className={`notify-pill${on ? ' on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      aria-busy={pending === field || undefined}
      disabled={pending !== null}
      onClick={e => { e.stopPropagation(); press(field) }}
    >
      <span className="notify-pill-icon" aria-hidden="true">
        {pending === field ? <span className="notify-spinner" /> : on ? <IcCheck /> : null}
      </span>
      <span>{text}</span>
    </button>
  )

  return (
    <div className="notify-strip" onClick={e => e.stopPropagation()}>
      <div className="notify-strip-row" role="group" aria-label={`Notifications for ${name}`}>
        <span className="notify-strip-label"><IcBell /><span>NOTIFY</span></span>
        {pill('notifyOnDown', state.down, 'Goes down', `Notify when ${name} goes down`)}
        {pill('notifyOnUp', state.up, 'Goes up', `Notify when ${name} goes up`)}
      </div>
      <button
        type="button"
        className="notify-more-toggle"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen(o => !o)}
      >
        <span className="notify-more-chevron">{moreOpen ? '−' : '+'}</span>
        More alerts
      </button>
      {moreOpen && (
        <div className="notify-more-pills">
          {pill('notifyOnMintMeltIssues', more.mintMelt, 'Mint/melt issues', `Notify when ${name} has mint or melt issues`)}
          {pill('notifyOnVersionOutdated', more.versionOutdated, 'Version outdated', `Notify when ${name} runs an outdated version`)}
          {pill('notifyOnNutLoss', more.nutLoss, 'Lost NUT04/05', `Notify when ${name} loses NUT-04 or NUT-05 support`)}
        </div>
      )}
      <div className="notify-strip-msg" role="status">{error}</div>
    </div>
  )
}
