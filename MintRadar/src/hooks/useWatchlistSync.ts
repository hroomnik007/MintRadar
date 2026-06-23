import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { fetchRemoteWatchlist, publishWatchlist } from '@/core/nostr/watchlistSync'
import { useUserRelays } from '@/hooks/useUserRelays'
import { db } from '@/db'

const WATCHLIST_OWNER_KEY = 'watchlistOwner'

export function useWatchlistSync() {
  const profile = useAuthStore(s => s.profile)
  const mints = useWatchlistStore(s => s.mints)
  const loadFromDb = useWatchlistStore(s => s.loadFromDb)
  const { write: userWriteRelays } = useUserRelays()
  // Ref so Phase 2 always uses the current relay list without re-triggering on relay changes
  const userWriteRelaysRef = useRef<string[] | null>(null)
  userWriteRelaysRef.current = userWriteRelays

  const syncedForPubkey = useRef<string | null>(null)
  const isSyncing = useRef(false)

  // Reset ALL sync state on logout so the next login triggers a fresh sync
  useEffect(() => {
    if (!profile?.pubkey) {
      console.log('sync: logout detected — resetting all sync state')
      syncedForPubkey.current = null
      isSyncing.current = false
    }
  }, [profile?.pubkey])

  // Phase 1: on login, fetch remote → replace Dexie → load into store
  useEffect(() => {
    const pubkey = profile?.pubkey
    if (!pubkey || syncedForPubkey.current === pubkey) return

    // Set isSyncing IMMEDIATELY (synchronously) before any async work
    // so Phase 2 is blocked from the moment this effect fires
    isSyncing.current = true
    console.log('sync: starting for pubkey', pubkey.slice(0, 8))

    const doSync = async () => {
      try {
        // Check if the Dexie data belongs to the current pubkey.
        // If a different user was previously logged in on this device, their Dexie
        // data must be cleared before loading — otherwise they'd see another user's mints.
        let dexieOwner: string | undefined
        try {
          const ownerEntry = await db.meta.get(WATCHLIST_OWNER_KEY)
          dexieOwner = ownerEntry?.value
        } catch { /* meta table not yet available on first run */ }

        if (dexieOwner !== pubkey) {
          console.log('sync: different owner in Dexie — clearing before load')
          await db.watchlist.clear()
        }

        console.log('sync: fetching kind:10003 from relays')
        const remote = await fetchRemoteWatchlist(pubkey, userWriteRelays)
        if (import.meta.env.DEV) { console.log(`sync: decrypted ${remote.length} mints`, remote) }

        if (remote.length > 0) {
          // Remote is authoritative — replace Dexie content entirely
          await db.watchlist.clear()
          await Promise.all(
            remote.map(url =>
              db.watchlist.put({ url, addedAt: new Date(), notifyOnDown: false, notifyOnUp: false })
            )
          )
          console.log('sync: written to Dexie')
        } else {
          console.log('sync: no remote data — using existing Dexie state for this pubkey')
        }

        // Record ownership so a different pubkey on next login clears Dexie
        await db.meta.put({ key: WATCHLIST_OWNER_KEY, value: pubkey })

        await loadFromDb()
        syncedForPubkey.current = pubkey
        console.log('sync: complete —', useWatchlistStore.getState().mints.length, 'mints in store')
      } catch (err) {
        console.warn('sync: error during Phase 1:', err)
        // Mark complete even on error to avoid getting stuck; Phase 2 can resume
        syncedForPubkey.current = pubkey
      } finally {
        isSyncing.current = false
      }
    }

    void doSync()
  }, [profile?.pubkey, loadFromDb])

  // Phase 2: publish current state to relays on any mint change,
  // but ONLY after sync has completed and is not currently running.
  // userWriteRelays is read from ref (not in deps) so NIP-65 relay list
  // resolving does not trigger an extra publish when mints haven't changed.
  useEffect(() => {
    const pubkey = profile?.pubkey
    if (!pubkey) return
    if (syncedForPubkey.current !== pubkey) return
    if (isSyncing.current) return
    if (import.meta.env.DEV) { console.log('sync: Phase 2 publishing', mints.length, 'mints to relays') }
    void publishWatchlist(pubkey, mints, userWriteRelaysRef.current)
  }, [mints, profile?.pubkey])
}
