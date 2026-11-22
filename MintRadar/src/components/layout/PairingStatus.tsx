import { useEffect, useState } from 'react'
import type { PairingStage } from '@/core/nostr/client'
import { pairingStatusText } from '@/utils/pairingStatus'

// The live status under the Remote signer pairing: relay connection + countdown to the 2-minute timeout (F2).
// Re-reads the relay state once a second; the parent remounts it (key) for a new pairing.
export function PairingStatus({ stage, deadline, relayConnected }: {
  stage: PairingStage
  deadline: number
  relayConnected: () => boolean
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="nostr-remote-status" aria-live="off">
      <span data-testid="pairing-status">{pairingStatusText(stage, relayConnected(), deadline - now)}</span>
      <span className="nostr-remote-status-sub">Approve the sign-in in your signer app.</span>
    </div>
  )
}
