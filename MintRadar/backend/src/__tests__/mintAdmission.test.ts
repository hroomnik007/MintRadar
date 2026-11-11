import { describe, it, expect } from 'vitest'
import { baseDomain, checkMintAdmission, rateLimitKey, MAX_MINTS_PER_BASE_DOMAIN, NEW_MANUAL_MINTS_PER_DAY, NEW_NOSTR_MINTS_PER_DAY, ADMISSION_ERRORS } from '../mintAdmission.js'

function fakeQuery(rows: { url: string; recent: boolean; added_via?: string | null }[]) {
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
    ['[2001:db8::1]', '[2001:db8::1]'],
    // Shared hosting: every tenant is its own base (Public Suffix List, private section, plus railway.app).
    ['mint.app.fly.dev', 'app.fly.dev'],
    ['app.fly.dev', 'app.fly.dev'],
    ['mymint.onrender.com', 'mymint.onrender.com'],
    ['mymint.herokuapp.com', 'mymint.herokuapp.com'],
    ['mymint.vercel.app', 'mymint.vercel.app'],
    ['mymint.up.railway.app', 'mymint.up.railway.app'],
    ['mymint.railway.app', 'mymint.railway.app'],
    ['mint.x.railway.app', 'x.railway.app'],
    ['abc.ngrok-free.app', 'abc.ngrok-free.app'],
    ['abc.ngrok.io', 'abc.ngrok.io'],
    ['me.github.io', 'me.github.io'],
    ['a.trycloudflare.com', 'a.trycloudflare.com'],
  ])('%s → %s', (host, base) => expect(baseDomain(host)).toBe(base))
})

describe('checkMintAdmission', () => {
  it('admits a URL that is already tracked, whatever the caps say', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ url: `https://m${i}.evil.com`, recent: true }))
    expect(await checkMintAdmission('https://m3.evil.com', 'manual', fakeQuery(rows))).toEqual({ ok: true })
  })

  it('refuses a new URL once its base domain has the maximum number of mints', async () => {
    const rows = Array.from({ length: MAX_MINTS_PER_BASE_DOMAIN }, (_, i) => ({ url: `https://m${i}.evil.com`, recent: false }))
    expect(await checkMintAdmission('https://another.evil.com', 'manual', fakeQuery(rows))).toEqual({ ok: false, reason: 'domain_cap', error: ADMISSION_ERRORS.domain_cap })
    expect(await checkMintAdmission('https://mint.other.com', 'manual', fakeQuery(rows))).toEqual({ ok: true })
  })

  it('does not let one shared hosting platform fill the domain cap for all its tenants', async () => {
    const rows = Array.from({ length: MAX_MINTS_PER_BASE_DOMAIN }, (_, i) => ({ url: `https://app${i}.fly.dev`, recent: false }))
    expect(await checkMintAdmission('https://another-app.fly.dev', 'manual', fakeQuery(rows))).toEqual({ ok: true })
    const sameTenant = Array.from({ length: MAX_MINTS_PER_BASE_DOMAIN }, (_, i) => ({ url: `https://m${i}.app.fly.dev`, recent: false }))
    expect(await checkMintAdmission('https://m9.app.fly.dev', 'nostr', fakeQuery(sameTenant))).toMatchObject({ ok: false, reason: 'domain_cap' })
  })

  it('refuses a new manual URL once the manual daily budget is used', async () => {
    const rows = Array.from({ length: NEW_MANUAL_MINTS_PER_DAY }, (_, i) => ({ url: `https://mint.d${i}.com`, recent: true, added_via: 'manual' }))
    expect(await checkMintAdmission('https://mint.fresh.com', 'manual', fakeQuery(rows))).toEqual({ ok: false, reason: 'daily_cap', error: ADMISSION_ERRORS.daily_cap })
    const older = rows.map(r => ({ ...r, recent: false }))
    expect(await checkMintAdmission('https://mint.fresh.com', 'manual', fakeQuery(older))).toEqual({ ok: true })
  })

  it('keeps separate daily budgets: Nostr discovery cannot use up the manual one, and the other way round', async () => {
    const nostrFull = Array.from({ length: NEW_MANUAL_MINTS_PER_DAY * 3 }, (_, i) => ({ url: `https://mint.n${i}.com`, recent: true, added_via: 'nostr' }))
    expect(await checkMintAdmission('https://mint.by-hand.com', 'manual', fakeQuery(nostrFull))).toEqual({ ok: true })
    expect(await checkMintAdmission('https://mint.by-event.com', 'nostr', fakeQuery(nostrFull))).toMatchObject({ ok: false, reason: 'daily_cap' })
    const nostrAtBudget = nostrFull.slice(0, NEW_NOSTR_MINTS_PER_DAY)
    expect(await checkMintAdmission('https://mint.by-event.com', 'nostr', fakeQuery(nostrAtBudget))).toMatchObject({ ok: false, reason: 'daily_cap' })
    expect(await checkMintAdmission('https://mint.by-event.com', 'nostr', fakeQuery(nostrAtBudget.slice(1)))).toEqual({ ok: true })
    const manualFull = Array.from({ length: NEW_MANUAL_MINTS_PER_DAY }, (_, i) => ({ url: `https://mint.m${i}.com`, recent: true, added_via: 'manual' }))
    expect(await checkMintAdmission('https://mint.by-event.com', 'nostr', fakeQuery(manualFull))).toEqual({ ok: true })
  })

  it('rows without added_via (older rows, seed list) count toward neither budget', async () => {
    const legacy = Array.from({ length: 100 }, (_, i) => ({ url: `https://mint.l${i}.com`, recent: true, added_via: null }))
    expect(await checkMintAdmission('https://mint.fresh.com', 'manual', fakeQuery(legacy))).toEqual({ ok: true })
    expect(await checkMintAdmission('https://mint.fresh.com', 'nostr', fakeQuery(legacy))).toEqual({ ok: true })
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
