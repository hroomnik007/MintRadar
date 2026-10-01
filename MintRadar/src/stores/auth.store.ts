import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { loginWithNip07, loginWithNsec, loginWithBunker, removeBunkerShim, removeNsecShim, hasActiveNsecKey, type NostrProfile } from '@/core/nostr/client'

export interface Nip65Relays {
  read: string[]
  write: string[]
}

// How the current session authenticated. Persisted alongside the profile so the
// navbar badge survives a reload. `null` when logged out.
export type LoginMethod = 'nip07' | 'nsec' | 'remote-signer' | null

interface AuthState {
  profile: NostrProfile | null
  method: LoginMethod
  nip65Relays: Nip65Relays | null
  isLoading: boolean
  error: string | null
  // One-off notice shown by the app shell. In-memory only (not in partialize).
  sessionNotice: string | null
  dismissSessionNotice: () => void
  login: () => Promise<void>
  loginNsec: (input: string) => Promise<void>
  loginBunker: (input: string) => Promise<void>
  logout: () => void
  isLoggedIn: () => boolean
  setNip65Relays: (relays: Nip65Relays) => void
  updateProfileMeta: (pubkey: string, meta: { name?: string; picture?: string }) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: null,
      method: null,
      nip65Relays: null,
      isLoading: false,
      error: null,
      sessionNotice: null,
      dismissSessionNotice: () => set({ sessionNotice: null }),

      login: async () => {
        set({ isLoading: true, error: null })
        try {
          const profile = await loginWithNip07()
          set({ profile, method: 'nip07', isLoading: false })
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Login failed',
            isLoading: false,
          })
        }
      },

      loginNsec: async (input: string) => {
        set({ isLoading: true, error: null })
        try {
          const profile = await loginWithNsec(input)
          set({ profile, method: 'nsec', isLoading: false })
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Login failed',
            isLoading: false,
          })
        }
      },

      loginBunker: async (input: string) => {
        set({ isLoading: true, error: null })
        try {
          const profile = await loginWithBunker(input)
          set({ profile, method: 'remote-signer', isLoading: false })
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Connection failed',
            isLoading: false,
          })
        }
      },

      logout: () => {
        removeBunkerShim()
        removeNsecShim()
        set({ profile: null, method: null, nip65Relays: null, error: null })
      },

      isLoggedIn: () => get().profile !== null,

      setNip65Relays: (relays: Nip65Relays) => {
        set({ nip65Relays: relays })
      },

      updateProfileMeta: (pubkey: string, meta: { name?: string; picture?: string }) => {
        const current = get().profile
        if (!current || current.pubkey !== pubkey) return
        set({ profile: { ...current, ...meta } })
      },
    }),
    {
      name: 'mintradar_session',
      storage: createJSONStorage(() => sessionStorage),
      // nip65Relays is persisted alongside profile/method so a page reload
      // doesn't re-run the kind:10002 bootstrap fetch from scratch.
      partialize: (state) => ({ profile: state.profile, method: state.method, nip65Relays: state.nip65Relays }),
    }
  )
)

export const STALE_NSEC_NOTICE = 'Your key was cleared when the page reloaded. Log in again to sign.'

// The persisted session survives a reload but the nsec key (module memory only)
// does not, so a persisted nsec session with no key held is stale: it would look
// logged in while nothing can sign. Run ONCE at startup, before the first render
// (sessionStorage hydration is synchronous), so it cannot race a fresh login and
// nothing that starts on login (notifications, remote watchlist sync) ever sees
// the stale profile. Same state as a normal logout; no network, no local-data wipe.
// nip07 (window.nostr may be injected late) and remote-signer (restored by
// restoreBunkerSession) are deliberately left alone.
export function clearStaleNsecSession(): void {
  if (useAuthStore.getState().method !== 'nsec' || hasActiveNsecKey()) return
  useAuthStore.getState().logout()
  useAuthStore.setState({ sessionNotice: STALE_NSEC_NOTICE })
}
