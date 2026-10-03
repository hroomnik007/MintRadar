import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { db } from '@/db'

/**
 * 'pending' — Phase 1 sync (relay fetch + Dexie load) hasn't finished yet for
 * the current pubkey. Gates the Watchlist empty-state so it can't flash
 * before real data has had a chance to load — see useWatchlistSync.ts.
 * 'done' — sync finished (with or without remote data).
 * 'error' — sync finished but the remote relay fetch failed outright
 * (timeout / decrypt / connection errors), as opposed to genuinely finding
 * no kind:10003 event.
 */
export type WatchlistSyncStatus = 'pending' | 'done' | 'error'

export interface WatchlistNotice { id: number; text: string }

let nextNoticeId = 1
const MAX_NOTICES = 3

interface WatchlistState {
  mints: string[]
  // Short dismissible notices shown by AppShell (e.g. a failed notification cancel on removal).
  notices: WatchlistNotice[]
  pushNotice: (text: string) => void
  dismissNotice: (id: number) => void
  isLoaded: boolean
  syncStatus: WatchlistSyncStatus
  setSyncStatus: (status: WatchlistSyncStatus) => void
  loadFromDb: () => Promise<void>
  addMint: (url: string) => Promise<void>
  removeMint: (url: string) => Promise<void>
  clearWatchlist: () => Promise<void>
  resetInMemory: () => void
  isWatching: (url: string) => boolean
}

export const useWatchlistStore = create<WatchlistState>()(
  immer((set, get) => ({
    mints: [],
    notices: [],
    isLoaded: false,
    syncStatus: 'pending',

    pushNotice: (text: string) => {
      set(state => {
        state.notices.push({ id: nextNoticeId++, text })
        if (state.notices.length > MAX_NOTICES) state.notices.shift()
      })
    },

    dismissNotice: (id: number) => {
      set(state => {
        state.notices = state.notices.filter(n => n.id !== id)
      })
    },

    setSyncStatus: (status: WatchlistSyncStatus) => {
      set(state => {
        state.syncStatus = status
      })
    },

    loadFromDb: async () => {
      const entries = await db.watchlist.toArray()
      set(state => {
        state.mints = entries.map(e => e.url)
        state.isLoaded = true
      })
    },

    addMint: async (url: string) => {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new TypeError('URL must start with http:// or https://')
      }
      await db.watchlist.put({
        url,
        addedAt: new Date(),
        // A newly watched mint starts with notifications OFF; the user turns them on deliberately
        // (that is what creates the server subscription).
        notifyOnDown: false,
        notifyOnUp: false,
      })
      set(state => {
        if (!state.mints.includes(url)) {
          state.mints.push(url)
        }
      })
    },

    removeMint: async (url: string) => {
      await db.watchlist.delete(url)
      set(state => {
        state.mints = state.mints.filter(m => m !== url)
      })
    },

    clearWatchlist: async () => {
      await db.watchlist.clear()
      set(state => {
        state.mints = []
        state.isLoaded = false
      })
    },

    resetInMemory: () => {
      set(state => {
        state.mints = []
        state.isLoaded = false
        state.syncStatus = 'pending'
      })
    },

    isWatching: (url: string) => {
      return get().mints.includes(url)
    },
  }))
)
