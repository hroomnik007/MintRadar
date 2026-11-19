import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown } from 'lucide-react'
import { db } from '@/db'
import { useUserRelays } from '@/hooks/useUserRelays'
import { setNotifyFlags, type NotifyFailure, type NotifyField } from '@/core/nostr/notificationSubscription'
import { confirmedNotify, confirmedMoreNotify } from '@/utils/notifyState'
import { moreAlertsNote, notifyLimitText } from '@/utils/tooltipTexts'

const FAILURE_TEXT: Record<NotifyFailure, string | null> = {
  'signer-unavailable': 'No signer available. Log in again.',
  'signer-declined': 'Signer declined the request.',
  'signer-timeout': "Signer didn't respond. Try again.",
  unreachable: "Couldn't reach the server. Try again.",
  'rate-limited': 'Too many requests. Try again later.',
  limit: notifyLimitText(),
  rejected: null, // generic message below
}

const IcCheck = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M1.8 5.3L4 7.5L8.2 2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

/** Which control is waiting for the server: the Alerts switch or one of the three "More alerts" pills. */
type Pending = 'alerts' | NotifyField | null

/**
 * The alerts of one watched mint (Watchlist row, 2026-11-19 mockup alignment). The "Alerts" switch turns "goes down" and
 * "goes up" on or off together in ONE request; "More alerts" opens the other three as pills. Every control is on only
 * when the server confirmed it (confirmedNotify): a press stays pending until the server answers and never shows "on"
 * early. Returns null until the IndexedDB entry is read.
 */
export function WatchAlerts({ mintUrl, name }: { mintUrl: string; name: string }) {
  const { read: userReadRelays, dm: dmRelays } = useUserRelays()
  const entry = useLiveQuery(() => db.watchlist.get(mintUrl), [mintUrl])
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // Synchronous guard: a second click in the same tick (before React re-renders `pending`) is dropped.
  const busy = useRef(false)

  if (!entry) return null
  const state = confirmedNotify(entry)
  const more = confirmedMoreNotify(entry)
  // On when either is on (an older entry can hold only one of the two); switching sets both to the new value.
  const alertsOn = state.down || state.up

  const send = (which: Exclude<Pending, null>, changes: Partial<Record<NotifyField, boolean>>, turningOn: boolean) => {
    if (busy.current) return
    busy.current = true
    setPending(which)
    void setNotifyFlags(mintUrl, changes, userReadRelays, dmRelays).then(result => {
      if (result.ok) setError(null)
      else setError(FAILURE_TEXT[result.reason] ?? `Couldn't turn ${turningOn ? 'on' : 'off'} notifications. Try again.`)
    }).finally(() => {
      busy.current = false
      setPending(null)
    })
  }

  const moreIsOn: Record<'notifyOnMintMeltIssues' | 'notifyOnVersionOutdated' | 'notifyOnNutLoss', boolean> = {
    notifyOnMintMeltIssues: more.mintMelt,
    notifyOnVersionOutdated: more.versionOutdated,
    notifyOnNutLoss: more.nutLoss,
  }
  const pill = (field: keyof typeof moreIsOn, text: string, label: string) => {
    const on = moreIsOn[field]
    return (
      <button
        type="button"
        className={`notify-pill${on ? ' on' : ''}`}
        aria-pressed={on}
        aria-label={label}
        aria-busy={pending === field || undefined}
        disabled={pending !== null}
        onClick={e => { e.stopPropagation(); send(field, { [field]: !on }, !on) }}
      >
        <span className="notify-pill-icon" aria-hidden="true">
          {pending === field ? <span className="notify-spinner" /> : on ? <IcCheck /> : null}
        </span>
        <span>{text}</span>
      </button>
    )
  }

  const moreCount = Object.values(moreIsOn).filter(Boolean).length
  return (
    <div className="notify-strip" onClick={e => e.stopPropagation()}>
      <div className="notify-strip-row" role="group" aria-label={`Alerts for ${name}`}>
        <button
          type="button"
          role="switch"
          className="wl-switch"
          aria-checked={alertsOn}
          aria-label={`Alerts for ${name}: a private message when it goes down or comes back`}
          aria-busy={pending === 'alerts' || undefined}
          disabled={pending !== null}
          onClick={() => send('alerts', { notifyOnDown: !alertsOn, notifyOnUp: !alertsOn }, !alertsOn)}
        >
          {pending === 'alerts' && <span className="notify-spinner" aria-hidden="true" />}
        </button>
        <span className="wl-switch-label" aria-hidden="true">Alerts</span>
        <button
          type="button"
          className="notify-more-toggle"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(o => !o)}
        >
          More alerts{moreCount > 0 ? ` (${moreCount} on)` : ''}
          <ChevronDown size={14} aria-hidden="true" className="notify-more-chevron" />
        </button>
      </div>
      {moreOpen && (
        <div className="notify-more-pills">
          {pill('notifyOnMintMeltIssues', 'Mint/melt issues', `Notify when ${name} has mint or melt issues`)}
          {pill('notifyOnVersionOutdated', 'Version outdated', `Notify when ${name} runs an outdated version`)}
          {pill('notifyOnNutLoss', 'Lost NUT04/05', `Notify when ${name} loses NUT-04 or NUT-05 support`)}
          <p className="notify-more-note">{moreAlertsNote()}</p>
        </div>
      )}
      <div className="notify-strip-msg" role="status">{error}</div>
    </div>
  )
}
