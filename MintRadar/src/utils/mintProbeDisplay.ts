/** Display helpers for live /v1/info + keysets on Mint Detail. */

export function formatKeysetFee(ppk: number | undefined): string {
  if (typeof ppk !== 'number') return ''
  return ppk === 0 ? 'free' : `${ppk} ppk`
}

export function clockDriftLabel(mintUnixSec: number, nowSec = Math.floor(Date.now() / 1000)): {
  label: string
  color: string
} {
  const drift = mintUnixSec - nowSec
  const abs = Math.abs(drift)
  if (abs < 30) return { label: 'in sync', color: '#4ade80' }
  const label = `${drift > 0 ? '+' : '−'}${abs < 120 ? `${abs}s` : `${Math.round(abs / 60)}m`}`
  return { label, color: abs < 120 ? '#f59e0b' : '#ff4d4d' }
}

export function urlIsOnion(u: string): boolean {
  try {
    return new URL(u).hostname.toLowerCase().endsWith('.onion')
  } catch {
    return u.toLowerCase().includes('.onion')
  }
}

export function listHasOnion(urls: string[] | null | undefined): boolean {
  return (urls ?? []).some(urlIsOnion)
}

/** Operator-notice MOTD (maintenance / move / pause). Not generic disclaimers. */
const MOTD_ALERT_NEEDLES = [
  'migrat',
  'offline',
  'mainten',
  'paused',
  'shut',
  'deprecated',
  'moved to',
  'new url',
]

export function isMotdAlert(motd: string | null | undefined): boolean {
  if (!motd) return false
  const s = motd.trim().toLowerCase()
  if (!s) return false
  return MOTD_ALERT_NEEDLES.some(n => s.includes(n))
}
