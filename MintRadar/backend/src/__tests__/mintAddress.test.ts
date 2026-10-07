import { describe, it, expect, vi, beforeEach } from 'vitest'

const { queryMock, dnsMock } = vi.hoisted(() => ({ queryMock: vi.fn(), dnsMock: { resolve4: vi.fn() } }))
vi.mock('../db.js', () => ({ pool: { query: queryMock } }))
vi.mock('dns/promises', () => dnsMock)
vi.mock('../ssrf.js', () => ({ isBlockedIpString: (ip: string) => ip.startsWith('10.') || ip.startsWith('127.') }))

import { resolveMintIpv4, refreshMintAddresses } from '../mintAddress.js'

beforeEach(() => { queryMock.mockReset(); dnsMock.resolve4.mockReset() })

describe('resolveMintIpv4', () => {
  it('first public IPv4, private answers skipped', async () => {
    dnsMock.resolve4.mockResolvedValue(['10.0.0.1', '188.166.166.165'])
    expect(await resolveMintIpv4('https://mint.lnpay.cz')).toBe('188.166.166.165')
  })
  it('only private answers: null', async () => {
    dnsMock.resolve4.mockResolvedValue(['10.0.0.1'])
    expect(await resolveMintIpv4('https://x.example')).toBeNull()
  })
  it('onion host and IP literal: null, no lookup', async () => {
    expect(await resolveMintIpv4('http://abcdef.onion')).toBeNull()
    expect(await resolveMintIpv4('https://1.2.3.4')).toBeNull()
    expect(dnsMock.resolve4).not.toHaveBeenCalled()
  })
  it('no A record: null; any other error: undefined (keep the old value)', async () => {
    dnsMock.resolve4.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ENODATA' }))
    expect(await resolveMintIpv4('https://v6only.example')).toBeNull()
    dnsMock.resolve4.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ETIMEOUT' }))
    expect(await resolveMintIpv4('https://slow.example')).toBeUndefined()
  })
})

describe('refreshMintAddresses', () => {
  it('writes only changed addresses and leaves failed lookups alone', async () => {
    queryMock.mockImplementation(async (sql: string) => sql.startsWith('SELECT')
      ? { rows: [{ url: 'https://a', ip_address: null }, { url: 'https://b', ip_address: '1.1.1.1' }, { url: 'https://c', ip_address: '2.2.2.2' }, { url: 'https://d', ip_address: '3.3.3.3' }] }
      : { rows: [] })
    const answers: Record<string, string | null | undefined> = { 'https://a': '9.9.9.9', 'https://b': '1.1.1.1', 'https://c': undefined, 'https://d': null }
    const stats = await refreshMintAddresses(async u => answers[u])
    expect(stats).toEqual({ checked: 4, changed: 2 })
    const updates = queryMock.mock.calls.filter(c => String(c[0]).startsWith('UPDATE')).map(c => c[1])
    expect(updates).toEqual([['9.9.9.9', 'https://a'], [null, 'https://d']])
  })
})
