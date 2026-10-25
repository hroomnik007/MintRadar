// Lazy entry points into the Nostr client, the relay pool and the IndexedDB (Dexie) layer (Stage 2 perf,
// 2026-10-25). vendor-nostr (~147 kB) and vendor-db (~97 kB) used to be modulepreloaded on every page because
// the eager app code imported them statically. Eager code (main.tsx, stores, AppShell, Dashboard, MintCard,
// hooks run on every page) now reaches them only through these loaders, so the chunks are fetched after the
// first render or on first use (login, reviews, watchlist, notifications), never in the initial preload.
// Pages that are lazy routes themselves (Mint Detail, Watchlist, MintNaddr, Tools, Stats) may import them
// statically. Rule for new eager code: no static import of nostr-tools (except `nostr-tools/nip19`, its own
// small chunk), '@/core/nostr/client', '@/core/nostr/pool' or '@/db' (test: lazyVendorChunks.test.ts).
import { hasStoredBunkerSession } from '@/core/nostr/bunkerSessionKeys'

type ClientModule = typeof import('@/core/nostr/client')

let clientPromise: Promise<ClientModule> | null = null
let clientModule: ClientModule | null = null

/** The Nostr client module (login, signer shims, bunker, profile bootstrap); loaded once. */
export function loadNostrClient(): Promise<ClientModule> {
  clientPromise ??= import('@/core/nostr/client').then(m => {
    clientModule = m
    return m
  })
  return clientPromise
}

/**
 * Runs `fn` with the client module now if it is loaded, after the load if one is in progress, and not at all
 * if it was never requested: no signer shim can exist then, because only that module installs them.
 */
export function withNostrClientIfLoaded(fn: (m: ClientModule) => void): void {
  if (clientModule) fn(clientModule)
  else if (clientPromise) void clientPromise.then(fn)
}

/** The client module if already loaded (synchronous checks such as hasActiveNsecKey), else null. */
export function loadedNostrClient(): ClientModule | null {
  return clientModule
}

/** The app's shared SimplePool. */
export function loadSharedPool(): Promise<typeof import('@/core/nostr/pool').sharedPool> {
  return import('@/core/nostr/pool').then(m => m.sharedPool)
}

/** The Dexie database. */
export function loadDb(): Promise<typeof import('@/db').db> {
  return import('@/db').then(m => m.db)
}

let bunkerRestore: Promise<void> = Promise.resolve()

/**
 * Startup: restores a remote-signer session only when one is stored (the client module is not loaded for
 * anyone else). The window.nostr shim used to be installed right after start; it now follows the chunk load,
 * so code that signs or decrypts at login (watchlist sync) awaits whenBunkerRestored() first.
 */
export function startBunkerRestore(): Promise<void> {
  if (!hasStoredBunkerSession()) return bunkerRestore
  bunkerRestore = loadNostrClient()
    .then(m => m.restoreBunkerSession())
    .catch(() => {})
  return bunkerRestore
}

/** Resolves once a startup bunker restore (if any) has installed its shim or given up. */
export function whenBunkerRestored(): Promise<void> {
  return bunkerRestore
}
