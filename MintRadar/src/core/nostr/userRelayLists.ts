import { useAuthStore } from '@/stores/auth.store'
import { sanitizeUserRelays } from '@/core/nostr/relayHints'

// The logged-in user's relay lists as WE use them, derived from the auth store (the one source for useUserRelays and
// for code that needs the current value outside React). Only what we connect to is filtered (public wss:// hosts,
// max 10 each); the stored lists stay as published. An empty or missing list is null.
export interface UserRelays { read: string[] | null; write: string[] | null; dm: string[] | null }

export function deriveUserRelays(
  nip65Relays: { read: string[]; write: string[] } | null | undefined,
  dmRelays: string[] | null | undefined,
): UserRelays {
  const read = nip65Relays ? sanitizeUserRelays(nip65Relays.read) : []
  const write = nip65Relays ? sanitizeUserRelays(nip65Relays.write) : []
  const dm = sanitizeUserRelays(dmRelays)
  return {
    read: read.length > 0 ? read : null,
    write: write.length > 0 ? write : null,
    dm: dm.length > 0 ? dm : null,
  }
}

/** Longest the once-per-login notification refresh waits for the relay lists (the bootstrap itself ends after 6 s). */
export const RELAY_LISTS_WAIT_MS = 8000

// The bootstrap (client.ts bootstrapUserData) writes `dmRelays` (the list, or [] when there is none) only when its
// subscription has ended, so `dmRelays !== null` means "the relay lists are loaded or known to be absent". Resolves
// at once if that already holds, otherwise when it does, and in any case after `timeoutMs` so a slow or failed
// lookup never blocks the caller (it then goes on with what it has, i.e. the fixed fallback list).
export function waitForRelayLists(timeoutMs: number = RELAY_LISTS_WAIT_MS): Promise<void> {
  // `!== null` (not `!== undefined`): only an explicit null means "not loaded yet".
  const settled = () => useAuthStore.getState().dmRelays !== null
  if (settled()) return Promise.resolve()
  return new Promise<void>(resolve => {
    let unsubscribe: () => void = () => {}
    const timer = setTimeout(() => { unsubscribe(); resolve() }, timeoutMs)
    unsubscribe = useAuthStore.subscribe(() => {
      if (!settled()) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}
