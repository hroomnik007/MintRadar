import { useEffect, useState } from 'react'
import { useMintChanges } from '@/hooks/useMintChanges'
import { useNow } from '@/hooks/useNow'
import { LoadError } from '@/components/LoadError'
import { formatTimeAgo } from '@/utils/mintFormatting'
import { formatDate, formatDateTimeUtc } from '@/utils/formatDate'
import { CHANGES_VISIBLE, MULTIPLE_CHANGES_TEXT, changeLabel, showFirstSeen, webChangeRows, changeLogEmptySince, type MintChange } from '@/utils/mintChangeLog'

export const CHANGE_LOG_ERROR = 'Change log is not available right now.'
export const CHANGE_LOG_EMPTY = 'No changes recorded yet.'
export const CHANGE_LOG_HINT = 'Confirmed changes in the public data this mint reports: seen in two checks in a row. Facts with a time, not a rating.'

function ChangeRow({ c, now }: { c: MintChange; now: number }) {
  const merged = c.newValue === MULTIPLE_CHANGES_TEXT && c.oldValue === null
  return (
    <li className="md-change" data-testid="change-row">
      <div className="md-change-head">
        <span className="md-change-type">{changeLabel(c.type)}</span>
        <time className="md-change-time" dateTime={c.observedAt} title={formatDateTimeUtc(c.observedAt)}>{formatTimeAgo(new Date(c.observedAt), now)}</time>
      </div>
      {merged ? (
        <div className="md-change-vals"><span className="md-change-val md-change-merged">{MULTIPLE_CHANGES_TEXT}</span></div>
      ) : (
        <div className="md-change-vals">
          <span className="md-change-val md-change-old">{c.oldValue ?? '—'}</span>
          <span className="md-change-arrow" aria-label="to">→</span>
          <span className="md-change-val md-change-new">{c.newValue ?? '—'}</span>
        </div>
      )}
      {showFirstSeen(c) && (
        <div className="md-change-first">seen first <time dateTime={c.firstSeenAt} title={formatDateTimeUtc(c.firstSeenAt)}>{formatTimeAgo(new Date(c.firstSeenAt), now)}</time></div>
      )}
    </li>
  )
}

/**
 * Mint Detail → History, below Version history. Fetched lazily when the panel mounts. Without rows to show there is no card,
 * only one muted line; while it loads the line's height is reserved.
 */
export function MintChangeLog({ url }: { url: string }) {
  // Armed after the first commit: Mint Detail applies a #history / #audit deep link in an effect AFTER its first render, which
  // briefly shows the Overview. A child effect runs before the parent's, so by the time this state is read nothing is mounted
  // that should not request.
  const [armed, setArmed] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setArmed(true) }, [])
  const { data, isPending, isError, refetch } = useMintChanges(url, armed)
  const isLoading = isPending && !isError
  const now = useNow()
  const [showAll, setShowAll] = useState(false)
  // Version changes are left out here: Version history above already lists the software versions.
  const changes = webChangeRows(data?.changes ?? [])
  const shown = showAll ? changes : changes.slice(0, CHANGES_VISIBLE)

  if (isLoading) return <div className="md-changes-line" data-testid="change-log-loading" aria-busy="true" />
  if (data && changes.length === 0) {
    return (
      <p className="md-changes-line" data-testid="change-log-empty">
        {data.trackingSince ? changeLogEmptySince(formatDate(data.trackingSince)) : CHANGE_LOG_EMPTY}
      </p>
    )
  }
  return (
    <div className="md-panel md-changes" data-testid="change-log">
      <div className="md-panel-title">Change log</div>
      <div className="md-panel-hint">{CHANGE_LOG_HINT}</div>
      {isError && <LoadError message={CHANGE_LOG_ERROR} onRetry={() => { void refetch() }} />}
      {data && changes.length > 0 && (
        <>
          <ul className="md-changes-list">
            {shown.map((c, i) => <ChangeRow key={`${c.observedAt}-${c.type}-${i}`} c={c} now={now} />)}
          </ul>
          {changes.length > CHANGES_VISIBLE && (
            <button type="button" className="audit-swaps-show-all-btn md-changes-toggle" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
              {showAll ? 'Show fewer' : `Show all (${changes.length})`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
