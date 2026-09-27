// Allowlist mode: run MintRadar as a closed monitor for a fixed set of mints.
//
// Set MINT_ALLOWLIST to a comma-separated list of mint URLs. While set:
//   - Nostr + API discovery never run (no relay traffic, no foreign mints)
//   - The Nostr reviews sync never runs (it subscribes to relays with every
//     known mint URL as a filter — undesirable for private deployments)
//   - The daily service-profile publish never runs
//   - /api/mint/submit, /api/mints/discover and /api/mint/probe reject any
//     URL outside the list
//   - Boot seeding uses the allowlist instead of the public KNOWN_MINTS list
//
// Unset (or empty / no valid entries) = default public behavior, unchanged.
import { normalizeUrl } from './discovery.js'

let cached: { raw: string; urls: Set<string> | null } | null = null

function parseAllowlist(): Set<string> | null {
  const raw = process.env['MINT_ALLOWLIST'] ?? ''
  if (cached && cached.raw === raw) return cached.urls
  const urls = raw
    .split(',')
    .map((entry) => normalizeUrl(entry.trim()))
    .filter((entry) => entry.startsWith('https://'))
  const parsed = urls.length > 0 ? new Set(urls) : null
  cached = { raw, urls: parsed }
  return parsed
}

export function isAllowlistMode(): boolean {
  return parseAllowlist() !== null
}

export function getAllowlistUrls(): string[] | null {
  const urls = parseAllowlist()
  return urls ? [...urls].sort() : null
}

// normalizeUrl upgrades http→https and lowercases hostnames, so both the
// env entries and the checked URL land on the same canonical form.
export function isAllowedUrl(url: string): boolean {
  const urls = parseAllowlist()
  if (!urls) return true
  return urls.has(normalizeUrl(url))
}
