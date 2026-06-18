import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { loginWithNip07, loginWithNsec, type NostrProfile } from '@/core/nostr/client'

interface AuthState {
  profile: NostrProfile | null
  isLoading: boolean
  error: string | null
  login: () => Promise<void>
  loginNsec: (input: string) => Promise<void>
  logout: () => void
  isLoggedIn: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: null,
      isLoading: false,
      error: null,

      login: async () => {
        set({ isLoading: true, error: null })
        try {
          const profile = await loginWithNip07()
          set({ profile, isLoading: false })
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
          set({ profile, isLoading: false })
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : 'Login failed',
            isLoading: false,
          })
        }
      },

      logout: () => {
        set({ profile: null, error: null })
      },

      isLoggedIn: () => get().profile !== null,
    }),
    {
      name: 'mintradar_session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ profile: state.profile }),
    }
  )
)
