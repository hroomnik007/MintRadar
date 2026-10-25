// sessionStorage keys of a remote-signer (NIP-46 bunker) session. Own module so startup can tell whether a
// session needs restoring without loading the Nostr client (src/core/nostr/lazy.ts).
export const BUNKER_URI_KEY = 'bunkerURI'
export const BUNKER_SECRET_KEY = 'bunkerClientSecretKey'
export const BUNKER_PUBKEY_KEY = 'bunkerPubkey'

/** All three keys are present: restoreBunkerSession() has something to restore. */
export function hasStoredBunkerSession(): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return !!sessionStorage.getItem(BUNKER_URI_KEY) && !!sessionStorage.getItem(BUNKER_SECRET_KEY) && !!sessionStorage.getItem(BUNKER_PUBKEY_KEY)
}

/** Forgets a stored session (logout before the client module has loaded; see auth.store logout). */
export function clearStoredBunkerSession(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(BUNKER_URI_KEY)
  sessionStorage.removeItem(BUNKER_SECRET_KEY)
  sessionStorage.removeItem(BUNKER_PUBKEY_KEY)
}
