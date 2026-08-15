/// <reference types="vite/client" />

interface Window {
  nostr?: {
    // Set only on shims MintRadar itself installs (nsec/bunker), so a new
    // login can tell "still-live MintRadar shim" apart from "real NIP-07
    // extension" before deciding whether to capture it as `original`.
    __mintradarShim?: true
    getPublicKey(): Promise<string>
    signEvent(event: object): Promise<object>
    nip04?: {
      encrypt(pubkey: string, plaintext: string): Promise<string>
      decrypt(pubkey: string, ciphertext: string): Promise<string>
    }
    nip44?: {
      encrypt(pubkey: string, plaintext: string): Promise<string>
      decrypt(pubkey: string, ciphertext: string): Promise<string>
    }
  }
}
