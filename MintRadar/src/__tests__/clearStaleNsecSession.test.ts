import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore, clearStaleNsecSession, STALE_NSEC_NOTICE } from '@/stores/auth.store'

const PROFILE = { pubkey: '1'.repeat(64), npub: 'npub1test' }
const HEX_KEY = '0000000000000000000000000000000000000000000000000000000000000001'

beforeEach(() => {
  useAuthStore.getState().logout()
  useAuthStore.setState({ sessionNotice: null })
  sessionStorage.clear()
})

describe('clearStaleNsecSession', () => {
  it('resets a persisted nsec session with no key held and sets the notice', () => {
    useAuthStore.setState({ profile: PROFILE, method: 'nsec', nip65Relays: { read: ['wss://r'], write: [] } })
    clearStaleNsecSession()
    const s = useAuthStore.getState()
    expect(s.profile).toBeNull()
    expect(s.method).toBeNull()
    expect(s.nip65Relays).toBeNull()
    expect(s.sessionNotice).toBe(STALE_NSEC_NOTICE)
  })

  it('does not clear an nsec session whose key is held (fresh login)', async () => {
    await useAuthStore.getState().loginNsec(HEX_KEY)
    expect(useAuthStore.getState().method).toBe('nsec')
    clearStaleNsecSession()
    expect(useAuthStore.getState().profile).not.toBeNull()
    expect(useAuthStore.getState().sessionNotice).toBeNull()
    useAuthStore.getState().logout()
  })

  it.each(['nip07', 'remote-signer'] as const)('leaves a %s session alone', method => {
    useAuthStore.setState({ profile: PROFILE, method })
    clearStaleNsecSession()
    expect(useAuthStore.getState().profile).toEqual(PROFILE)
    expect(useAuthStore.getState().sessionNotice).toBeNull()
  })

  it('does nothing when logged out, and never persists the notice', () => {
    clearStaleNsecSession()
    expect(useAuthStore.getState().sessionNotice).toBeNull()
    useAuthStore.setState({ profile: PROFILE, method: 'nsec' })
    clearStaleNsecSession()
    expect(sessionStorage.getItem('mintradar_session')).not.toContain('sessionNotice')
  })
})
