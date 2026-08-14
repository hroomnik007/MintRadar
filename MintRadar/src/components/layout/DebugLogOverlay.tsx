import { useEffect, useState } from 'react'
import { getDebugLogEntries } from '@/core/debugLog'

function relativeTime(ts: number, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  return `${diffHr}h ago`
}

// Debug-only overlay for viewing [watchlist-sync] console logs on-screen — for
// mobile browsers without remote debugging access. No-op unless ?debug=1.
export function DebugLogOverlay() {
  const enabled = new URLSearchParams(window.location.search).get('debug') === '1'
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => forceTick(t => t + 1), 500)
    return () => clearInterval(interval)
  }, [enabled])

  if (!enabled) return null

  const entries = getDebugLogEntries()
  const now = Date.now()
  const ordered = [...entries].reverse()

  const handleCopy = () => {
    const text = ordered.map(e => `[${relativeTime(e.timestamp, now)}] ${e.message}`).join('\n')
    void navigator.clipboard.writeText(text)
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '40vh',
        overflowY: 'auto',
        background: 'rgba(0,0,0,0.85)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.4,
        zIndex: 99999,
        padding: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong>watchlist-sync debug log ({entries.length})</strong>
        <button
          type="button"
          onClick={handleCopy}
          style={{ background: '#222', color: '#fff', border: '1px solid #555', padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}
        >
          Copy all
        </button>
      </div>
      {ordered.length === 0 && <div style={{ opacity: 0.6 }}>No logs yet.</div>}
      {ordered.map((entry, i) => (
        <div key={i} style={{ marginBottom: 4, wordBreak: 'break-word' }}>
          <span style={{ color: '#888' }}>[{relativeTime(entry.timestamp, now)}]</span> {entry.message}
        </div>
      ))}
    </div>
  )
}
