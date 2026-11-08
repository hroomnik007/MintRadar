import { describe, it, expect } from 'vitest'
import { baseDomain, checkMintAdmission, rateLimitKey, MAX_MINTS_PER_BASE_DOMAIN, NEW_MINTS_PER_DAY, ADMISSION_ERRORS } from '../mintAdmission.js'

function fakeQuery(rows: { url: string; recent: boolean }[]) {
  return () => Promise.resolve({ rows })
}

describe('baseDomain', () => {
  it.each([
    ['mint.example.com', 'example.com'],
    ['a.b.mint.example.com.', 'example.com'],
    ['example.com', 'example.com'],
    ['mint.example.co.uk', 'example.co.uk'],
    ['mint.example.com.br', 'example.com.br'],
    ['mint.example.cz', 'example.cz'],
    ['MINT.Example.ORG', 'example.org'],
    ['1.2.3.4', '1.2.3.4'],
    ['abc.onion', 'abc.onion'],
  ])('%s → %s', (host, base) => expect(baseDomain(host)).toBe(base))
})

describe('checkMintAdmission', () => {
  it('admits a URL that is already tracked, whatever the caps say', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ url: `https://m${i}.evil.com`, recent: true }))
    expect(await checkMintAdmission('https://m3.evil.com', fakeQuery(rows))).toEqual({ ok: true })
  })

  it('refuses a new URL once its base domain has the maximum number of mints', async () => {
    const rows = Array.from({ length: MAX_MINTS_PER_BASE_DOMAIN }, (_, i) => ({ url: `https://m${i}.evil.com`, recent: false }))
    expect(await checkMintAdmission('https://another.evil.com', fakeQuery(rows))).toEqual({ ok: false, reason: 'domain_cap', error: ADMISSION_ERRORS.domain_cap })
    expect(await checkMintAdmission('https://mint.other.com', fakeQuery(rows))).toEqual({ ok: true })
  })

  it('refuses a new URL once the daily cap of new mints is reached', async () => {
    const rows = Array.from({ length: NEW_MINTS_PER_DAY }, (_, i) => ({ url: `https://mint.d${i}.com`, recent: true }))
    expect(await checkMintAdmission('https://mint.fresh.com', fakeQuery(rows))).toEqual({ ok: false, reason: 'daily_cap', error: ADMISSION_ERRORS.daily_cap })
    const older = rows.map(r => ({ ...r, recent: false }))
    expect(await checkMintAdmission('https://mint.fresh.com', fakeQuery(older))).toEqual({ ok: true })
  })
})

describe('rateLimitKey', () => {
  it.each([
    [undefined, 'unknown'],
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:db8:1:2::9', '2001:db8:1:2::/64'],
    ['2001:0db8:0001:0002:ffff::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('%s → %s', (ip, key) => expect(rateLimitKey(ip)).toBe(key))

  it('puts every address of one /64 under one key', () => {
    expect(rateLimitKey('2001:db8:aa:bb::1')).toBe(rateLimitKey('2001:db8:aa:bb:ffff:ffff:ffff:fffe'))
  })
})
