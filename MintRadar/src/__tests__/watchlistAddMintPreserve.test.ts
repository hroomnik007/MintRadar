import { describe, it, expect, vi, beforeEach } from 'vitest'

const rows = vi.hoisted(() => new Map<string, Record<string, unknown>>())
vi.mock('@/core/nostr/lazy', () => ({
  loadDb: async () => ({
    watchlist: {
      get: async (url: string) => rows.get(url),
      put: async (e: { url: string }) => { rows.set(e.url, e) },
    },
  }),
}))

import { useWatchlistStore } from '@/stores/watchlist.store'

const URL = 'https://mint.example'

beforeEach(() => {
  rows.clear()
  useWatchlistStore.getState().resetInMemory()
})

describe('addMint — must not reset saved notification settings', () => {
  it('re-adding a mint already in Dexie while the in-memory list is still empty (slow signer login) keeps its flags', async () => {
    const confirmed = new Date('2026-11-01T00:00:00Z')
    rows.set(URL, { url: URL, addedAt: new Date(0), notifyOnDown: true, notifyOnUp: true, notifyOnNutLoss: true, notifyConfirmedAt: confirmed })
    await useWatchlistStore.getState().addMint(URL)
    expect(rows.get(URL)).toMatchObject({ notifyOnDown: true, notifyOnUp: true, notifyOnNutLoss: true, notifyConfirmedAt: confirmed })
    expect(useWatchlistStore.getState().mints).toEqual([URL])
  })

  it('a genuinely new mint still starts with notifications off', async () => {
    await useWatchlistStore.getState().addMint(URL)
    expect(rows.get(URL)).toMatchObject({ notifyOnDown: false, notifyOnUp: false })
  })
})
