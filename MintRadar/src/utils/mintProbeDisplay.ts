import type { MintKeyset } from '@core/mint/api'

/** Display helpers for live /v1/info + keysets on Mint Detail. */

export function formatKeysetFee(ppk: number | undefined): string {
  if (typeof ppk !== 'number') return ''
  return ppk === 0 ? 'free' : `${ppk} ppk`
}

export interface CompareInputFee {
  label: string
  unit: string
}

/**
 * The fee the Compare modal shows: the ACTIVE keyset(s) of the mint's primary
 * unit ('sat' when the mint has it, else the unit of its first active keyset).
 * If several active keysets of that unit disagree, the range is shown. Null
 * (→ "n/a") when keysets are unknown or no active keyset advertises input_fee_ppk.
 */
export function pickInputFee(keysets: MintKeyset[] | null | undefined): CompareInputFee | null {
  const active = (keysets ?? []).filter(k => k.active && typeof k.input_fee_ppk === 'number')
  if (active.length === 0) return null
  const unit = active.some(k => k.unit === 'sat') ? 'sat' : active[0]!.unit
  const fees = active.filter(k => k.unit === unit).map(k => k.input_fee_ppk as number)
  const min = Math.min(...fees)
  const max = Math.max(...fees)
  return { label: min === max ? formatKeysetFee(min) : `${min}–${max} ppk`, unit }
}

export function clockDriftLabel(mintUnixSec: number, nowSec = Math.floor(Date.now() / 1000)): {
  label: string
  color: string
} {
  const drift = mintUnixSec - nowSec
  const abs = Math.abs(drift)
  if (abs < 30) return { label: 'in sync', color: 'var(--accent)' }
  const label = `${drift > 0 ? '+' : '−'}${abs < 120 ? `${abs}s` : `${Math.round(abs / 60)}m`}`
  return { label, color: abs < 120 ? 'var(--amber)' : 'var(--red)' }
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
