import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { loginWithNip07, loginWithNsec, loginWithBunker, removeBunkerShim, removeNsecShim, type NostrProfile } from '@/core/nostr/client'

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
