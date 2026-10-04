import { useQuery } from '@tanstack/react-query'
import { useNow } from '@/hooks/useNow'
import { mintHostname } from '@/utils/mintFormatting'

// audit.cashu.cz data (second audit source). Display only: shown in the Audit tab
// when the audit.8333.space data is missing or stale. Fetched from OUR backend
// (/api/mints/audit-cz) — the browser never contacts audit.cashu.cz except by the
// plain link. Never merged into any MintRadar number, tile or score.
export interface AuditCzData {
  source: string
  sourceUrl: string | null
  fetchedAt: string | null
  covered: boolean
  mint: {
    state: string
    uptime24h: number | null
    uptime7d: number | null
    uptime30d: number | null
    attributedFailures: number | null
    lastCheck: string | null
  } | null
  swaps: Array<{
    id: string
    at: string
    status: string
    stage: string | null
    error: string | null
    amount: number | null
    fee: number | null
    durationMs: number | null
    direction: 'from' | 'to'
    otherMintUrl: string | null
    otherMintName: string | null
  }>
}

const STALE_AFTER_MS = 30 * 60 * 1000
const MAX_SWAP_ROWS = 10
const ERROR_MAX_CHARS = 60

function minutesAgoLabel(iso: string | null, now: number): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  const min = Math.max(0, Math.floor((now - t) / 60_000))
  if (min < 1) return 'less than a minute ago'
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

const pct = (v: number | null): string => (v === null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`)

const KNOWN_SWAP_STATUS = new Set(['success', 'failed', 'pending'])
const STATE_LABEL: Record<string, string> = { ok: 'OK', warn: 'Warning', error: 'Error' }

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}. ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

export function AuditCzBlock({ url }: { url: string }) {
  const now = useNow()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['mint', 'audit-cz', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/audit-cz?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch audit.cashu.cz data')
      return await res.json() as AuditCzData
    },
    staleTime: 60 * 1000,
  })

  if (isLoading) {
    return <div className="auditcz-muted" role="status">Loading audit.cashu.cz data…</div>
  }
  if (isError || !data) return null

  if (!data.covered || !data.mint) {
    return (
      <div className="md-panel auditcz-panel" aria-label="Source: audit.cashu.cz">
        <div className="auditcz-muted">Not covered by audit.cashu.cz</div>
      </div>
    )
  }

  const m = data.mint
  const updated = minutesAgoLabel(data.fetchedAt, now)
  const fetchedMs = data.fetchedAt ? new Date(data.fetchedAt).getTime() : NaN
  const stale = Number.isFinite(fetchedMs) && now - fetchedMs > STALE_AFTER_MS
  const lastCheck = minutesAgoLabel(m.lastCheck, now)
  const state = STATE_LABEL[m.state] ?? m.state
  const rows = data.swaps.slice(0, MAX_SWAP_ROWS)

  return (
    <div className="md-panel auditcz-panel" aria-label="Source: audit.cashu.cz">
      <div className="auditcz-head">
        <span className="md-panel-title" style={{ marginBottom: 0 }}>Source: audit.cashu.cz</span>
        {data.sourceUrl && (
          <a className="auditcz-link" href={data.sourceUrl} target="_blank" rel="noopener noreferrer"
             aria-label="Open this mint on audit.cashu.cz (opens in a new tab)">
            Open on audit.cashu.cz →
          </a>
        )}
      </div>
      <div className="auditcz-meta">
        {updated && <span>updated {updated}</span>}
        {stale && <span className="auditcz-stale">stale — not refreshed for over 30 minutes</span>}
      </div>

      <div className="auditcz-grid">
        <div className="auditcz-cell">
          <div className="auditcz-label">State (their verdict)</div>
          <div><span className={`auditcz-badge auditcz-badge-${m.state}`}>{state}</span></div>
        </div>
        <div className="auditcz-cell"><div className="auditcz-label">Uptime 24h</div><div className="auditcz-val">{pct(m.uptime24h)}</div></div>
        <div className="auditcz-cell"><div className="auditcz-label">Uptime 7d</div><div className="auditcz-val">{pct(m.uptime7d)}</div></div>
        <div className="auditcz-cell"><div className="auditcz-label">Uptime 30d</div><div className="auditcz-val">{pct(m.uptime30d)}</div></div>
        <div className="auditcz-cell">
          <div className="auditcz-label">Failures</div>
          <div className="auditcz-val">{m.attributedFailures ?? '—'}</div>
          <div className="auditcz-sub">attributed by audit.cashu.cz</div>
        </div>
        <div className="auditcz-cell"><div className="auditcz-label">Last check</div><div className="auditcz-val">{lastCheck ?? '—'}</div></div>
      </div>

      {rows.length > 0 && (
        <div className="auditcz-table-wrap">
          <table className="auditcz-table">
            <caption className="auditcz-sr">Recent swaps involving this mint, from audit.cashu.cz</caption>
            <thead>
              <tr><th scope="col">Time</th><th scope="col">Direction</th><th scope="col">Other mint</th><th scope="col">Status</th><th scope="col">Error</th><th scope="col">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map(s => {
                const other = s.otherMintName || (s.otherMintUrl ? mintHostname(s.otherMintUrl) : '—')
                const err = s.error ?? ''
                const shortErr = err.length > ERROR_MAX_CHARS ? `${err.slice(0, ERROR_MAX_CHARS)}…` : err
                return (
                  <tr key={s.id}>
                    <td>{shortTime(s.at)}</td>
                    <td>{s.direction === 'from' ? 'out →' : '← in'}</td>
                    <td className="auditcz-other" title={s.otherMintUrl ?? undefined}>{other}</td>
                    <td>{KNOWN_SWAP_STATUS.has(s.status) ? s.status : <span className="auditcz-badge auditcz-badge-neutral">{s.status}</span>}{s.stage ? ` (${s.stage})` : ''}</td>
                    <td className="auditcz-err" title={err || undefined}>{shortErr || '—'}</td>
                    <td>{s.amount ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
