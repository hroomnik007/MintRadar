import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  pool: { query: vi.fn() },
  initDb: vi.fn(),
}))

import { pool } from '../db.js'
import { normalizeMintPubkey, findMintsByPubkey, persistMintPubkeyIfChanged } from '../mintPubkey.js'

const query = pool.query as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  query.mockReset()
})

const VALID_02 = '02' + 'ab'.repeat(32)
const VALID_03 = '03' + 'cd'.repeat(32)

describe('normalizeMintPubkey', () => {
  it('accepts a valid 33-byte compressed secp256k1 hex key with a 02 prefix', () => {
    expect(normalizeMintPubkey(VALID_02)).toBe(VALID_02)
  })

  it('accepts a valid key with a 03 prefix', () => {
    expect(normalizeMintPubkey(VALID_03)).toBe(VALID_03)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeMintPubkey(`  ${VALID_02}  `)).toBe(VALID_02)
  })

  it('lowercases mixed-case hex', () => {
    expect(normalizeMintPubkey(VALID_02.toUpperCase())).toBe(VALID_02)
  })

  it('rejects garbage strings', () => {
    expect(normalizeMintPubkey('not-a-pubkey')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(normalizeMintPubkey('')).toBeNull()
  })

  it('rejects undefined / null / non-string input', () => {
    expect(normalizeMintPubkey(undefined)).toBeNull()
    expect(normalizeMintPubkey(null)).toBeNull()
    expect(normalizeMintPubkey(12345)).toBeNull()
  })

  it('rejects a key with a wrong length', () => {
    expect(normalizeMintPubkey('02' + 'ab'.repeat(31))).toBeNull()
    expect(normalizeMintPubkey('02' + 'ab'.repeat(33))).toBeNull()
  })

  it('rejects a key with an invalid parity prefix', () => {
    expect(normalizeMintPubkey('04' + 'ab'.repeat(32))).toBeNull()
  })

  it('rejects an uncompressed 65-byte pubkey', () => {
    expect(normalizeMintPubkey('04' + 'ab'.repeat(64))).toBeNull()
  })
})

describe('findMintsByPubkey', () => {
  it('returns [] without querying the DB for an invalid/empty pubkey', async () => {
    expect(await findMintsByPubkey(null, 'https://mint.example.com')).toEqual([])
    expect(await findMintsByPubkey('garbage', 'https://mint.example.com')).toEqual([])
    expect(query).not.toHaveBeenCalled()
  })

  it('returns matching rows, excluding the given URL', async () => {
    query.mockResolvedValueOnce({
      rows: [{ url: 'https://other.example.com', name: 'Other Mint' }],
    })
    const result = await findMintsByPubkey(VALID_02, 'https://mine.example.com')
    expect(result).toEqual([{ url: 'https://other.example.com', name: 'Other Mint' }])
    const [sql, params] = query.mock.calls[0]
    expect(sql).toContain('WHERE pubkey = $1 AND url <> $2')
    expect(params).toEqual([VALID_02, 'https://mine.example.com'])
  })

  it('normalizes null names to null', async () => {
    query.mockResolvedValueOnce({ rows: [{ url: 'https://other.example.com', name: null }] })
    const result = await findMintsByPubkey(VALID_02, 'https://mine.example.com')
    expect(result).toEqual([{ url: 'https://other.example.com', name: null }])
  })
})

describe('persistMintPubkeyIfChanged', () => {
  it('does nothing (no DB call at all) for an invalid pubkey', async () => {
    await persistMintPubkeyIfChanged('https://mint.example.com', 'garbage')
    expect(query).not.toHaveBeenCalled()
  })

  it('writes the pubkey on first observation (no prior stored value)', async () => {
    query.mockResolvedValueOnce({ rows: [{ pubkey: null }] }) // SELECT
    query.mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
    await persistMintPubkeyIfChanged('https://mint.example.com', VALID_02)
    expect(query).toHaveBeenCalledTimes(2)
    const [updateSql, updateParams] = query.mock.calls[1]
    expect(updateSql).toContain('UPDATE mints SET pubkey')
    expect(updateParams).toEqual([VALID_02, 'https://mint.example.com'])
  })

  it('is a no-op when the stored pubkey already matches', async () => {
    query.mockResolvedValueOnce({ rows: [{ pubkey: VALID_02 }] }) // SELECT
    await persistMintPubkeyIfChanged('https://mint.example.com', VALID_02)
    expect(query).toHaveBeenCalledTimes(1) // no UPDATE
  })

  it('overwrites and logs when the stored pubkey genuinely changes', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    query.mockResolvedValueOnce({ rows: [{ pubkey: VALID_02 }] }) // SELECT
    query.mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
    await persistMintPubkeyIfChanged('https://mint.example.com', VALID_03)
    expect(query).toHaveBeenCalledTimes(2)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('pubkey changed for https://mint.example.com'))
    logSpy.mockRestore()
  })
})
