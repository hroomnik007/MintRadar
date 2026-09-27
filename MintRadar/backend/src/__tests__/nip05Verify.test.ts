import { describe, it, expect, vi, beforeEach } from 'vitest'

const safeFetch = vi.fn()
vi.mock('../ssrf.js', () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }))

import { verifyNip05, isValidNip05Domain, isValidNip05Name, isValidPubkeyHex, _resetNip05VerifyCache } from '../nip05Verify.js'

const PUBKEY = 'a'.repeat(64)
const OTHER_PUBKEY = 'b'.repeat(64)

function jsonRes(ok: boolean, body: unknown) {
  return { ok, json: async () => body }
}

beforeEach(() => {
  safeFetch.mockReset()
  _resetNip05VerifyCache()
})

describe('input validation', () => {
  it('accepts a normal hostname and rejects garbage', () => {
    expect(isValidNip05Domain('mintradar.org')).toBe(true)
    expect(isValidNip05Domain('sub.mintradar.org')).toBe(true)
    expect(isValidNip05Domain('not a domain')).toBe(false)
    expect(isValidNip05Domain('')).toBe(false)
    expect(isValidNip05Domain('a'.repeat(260))).toBe(false)
  })

  it('accepts NIP-05 local-part charset and rejects anything else', () => {
    expect(isValidNip05Name('_')).toBe(true)
    expect(isValidNip05Name('wildcitizen7')).toBe(true)
    expect(isValidNip05Name('a.b-c_d')).toBe(true)
    expect(isValidNip05Name('has space')).toBe(false)
    expect(isValidNip05Name('has/slash')).toBe(false)
    expect(isValidNip05Name('')).toBe(false)
  })

  it('accepts a 64-char hex pubkey only', () => {
    expect(isValidPubkeyHex(PUBKEY)).toBe(true)
    expect(isValidPubkeyHex('not-hex')).toBe(false)
    expect(isValidPubkeyHex(PUBKEY.slice(0, 63))).toBe(false)
  })
})

describe('verifyNip05 — SSRF-safe proxy (never fetches on invalid input)', () => {
  it('rejects an invalid domain/name/pubkey without ever calling safeFetch', async () => {
    expect(await verifyNip05('not a domain', '_', PUBKEY)).toBe(false)
    expect(await verifyNip05('mintradar.org', 'bad name', PUBKEY)).toBe(false)
    expect(await verifyNip05('mintradar.org', '_', 'not-hex')).toBe(false)
    expect(safeFetch).not.toHaveBeenCalled()
  })

  it('returns true when the domain confirms the pubkey', async () => {
    safeFetch.mockResolvedValue(jsonRes(true, { names: { wildcitizen7: PUBKEY } }))
    expect(await verifyNip05('mintradar.org', 'wildcitizen7', PUBKEY)).toBe(true)
    expect(safeFetch).toHaveBeenCalledWith(
      'https://mintradar.org/.well-known/nostr.json?name=wildcitizen7',
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  it('returns false — not a false "unverified badge" — on a pubkey mismatch (fake claim)', async () => {
    safeFetch.mockResolvedValue(jsonRes(true, { names: { wildcitizen7: OTHER_PUBKEY } }))
    expect(await verifyNip05('mintradar.org', 'wildcitizen7', PUBKEY)).toBe(false)
  })

  it('returns false when the domain has no matching name entry', async () => {
    safeFetch.mockResolvedValue(jsonRes(true, { names: {} }))
    expect(await verifyNip05('mintradar.org', 'wildcitizen7', PUBKEY)).toBe(false)
  })

  it('fails closed (false, never throws) when the domain is unreachable', async () => {
    safeFetch.mockResolvedValue(null)
    await expect(verifyNip05('dead-domain.example', '_', PUBKEY)).resolves.toBe(false)
  })

  it('fails closed on a non-2xx response', async () => {
    safeFetch.mockResolvedValue(jsonRes(false, {}))
    expect(await verifyNip05('mintradar.org', '_', PUBKEY)).toBe(false)
  })

  it('fails closed on malformed JSON', async () => {
    safeFetch.mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json') } })
    expect(await verifyNip05('mintradar.org', '_', PUBKEY)).toBe(false)
  })

  it('caches a result and does not re-fetch for the same domain/name/pubkey', async () => {
    safeFetch.mockResolvedValue(jsonRes(true, { names: { _: PUBKEY } }))
    expect(await verifyNip05('mintradar.org', '_', PUBKEY)).toBe(true)
    expect(await verifyNip05('mintradar.org', '_', PUBKEY)).toBe(true)
    expect(safeFetch).toHaveBeenCalledTimes(1)
  })

  it('is case-insensitive when comparing the returned pubkey', async () => {
    safeFetch.mockResolvedValue(jsonRes(true, { names: { _: PUBKEY.toUpperCase() } }))
    expect(await verifyNip05('mintradar.org', '_', PUBKEY)).toBe(true)
  })
})
