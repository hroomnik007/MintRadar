// F2 (UI/UX report 2026-11-22): the Remote signer status line names the relay state and counts down to the timeout.
import { describe, it, expect } from 'vitest'
import { formatCountdown, pairingStatusText } from '@/utils/pairingStatus'

describe('formatCountdown', () => {
  it('m:ss, rounded up to the next second, never negative', () => {
    expect(formatCountdown(120_000)).toBe('2:00')
    expect(formatCountdown(102_001)).toBe('1:43')
    expect(formatCountdown(9_000)).toBe('0:09')
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(-5_000)).toBe('0:00')
  })
})

describe('pairingStatusText', () => {
  it('connected relay: waiting for approval with the time left', () => {
    expect(pairingStatusText('awaiting-signer', true, 102_000)).toBe('Connected to relay · waiting for approval (1:42)')
  })
  it('no relay yet: connecting', () => {
    expect(pairingStatusText('awaiting-signer', false, 118_000)).toBe('Connecting to relay… (1:58)')
  })
  it('signer approved: waiting for the public key', () => {
    expect(pairingStatusText('awaiting-pubkey', true, 60_000)).toBe('Signer approved, waiting for your public key (1:00)')
  })
})
