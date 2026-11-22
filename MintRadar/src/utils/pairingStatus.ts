// Remote signer pairing status line in the login modal (UI/UX report F2, 2026-11-22): whether a pairing relay is
// connected and how long until the 2-minute pairing timeout, e.g. "Connected to relay · waiting for approval (1:42)".
import type { PairingStage } from '@/core/nostr/client'

/** m:ss, never negative ("0:00" at and after the deadline). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function pairingStatusText(stage: PairingStage, relayConnected: boolean, msLeft: number): string {
  const left = `(${formatCountdown(msLeft)})`
  if (stage === 'awaiting-pubkey') return `Signer approved, waiting for your public key ${left}`
  return relayConnected ? `Connected to relay · waiting for approval ${left}` : `Connecting to relay… ${left}`
}
