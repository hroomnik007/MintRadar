import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../nostrService.js', () => ({ notifySubscribers: vi.fn(), isNotificationServiceEnabled: vi.fn().mockReturnValue(false) }))
vi.mock('../versionCatalog.js', () => ({ getLatestVersionsMap: vi.fn().mockResolvedValue({}) }))

let query: ReturnType<typeof vi.fn>
let refreshServerLocations: typeof import('../prober.js')['refreshServerLocations']

beforeEach(async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  ;({ pool: { query } } = (await import('../db.js')) as unknown as { pool: { query: ReturnType<typeof vi.fn> } })
  query.mockReset()
  ;({ refreshServerLocations } = await import('../prober.js'))
})

const run = async (lookup: (u: string) => Promise<string | null>) => {
  const p = refreshServerLocations(lookup)
  await vi.runAllTimersAsync()
  return p
}

describe('refreshServerLocations', () => {
  it('overwrites a changed location (the mint moved), leaves an unchanged one, never nulls on a failed lookup', async () => {
    query.mockResolvedValueOnce({ rows: [
      { url: 'https://moved.example', server_location: 'Toronto, CA' },
      { url: 'https://same.example', server_location: 'Frankfurt am Main, DE' },
      { url: 'https://failing.example', server_location: 'Boston, US' },
      { url: 'https://new.example', server_location: null },
    ] })
    query.mockResolvedValue({ rows: [] })
    const answers: Record<string, string | null> = {
      'https://moved.example': 'Frankfurt am Main, DE',
      'https://same.example': 'Frankfurt am Main, DE',
      'https://failing.example': null,
      'https://new.example': 'Linz, AT',
    }
    const stats = await run(async u => answers[u] ?? null)
    expect(stats).toEqual({ checked: 4, changed: 2 })
    const updates = query.mock.calls.filter(c => String(c[0]).startsWith('UPDATE mints SET server_location'))
    expect(updates.map(c => c[1])).toEqual([['Frankfurt am Main, DE', 'https://moved.example'], ['Linz, AT', 'https://new.example']])
  })

  it('a database error is logged and swallowed', async () => {
    query.mockRejectedValueOnce(new Error('db down'))
    expect(await run(async () => 'X, YY')).toEqual({ checked: 0, changed: 0 })
  })
})

describe('refreshServerLocations with network facts', () => {
  it('stores AS / organisation / country from the same lookup, and nothing when ipinfo gave none', async () => {
    query.mockResolvedValueOnce({ rows: [
      { url: 'https://a.example', server_location: 'Frankfurt am Main, DE' },
      { url: 'https://b.example', server_location: null },
    ] })
    query.mockResolvedValue({ rows: [] })
    const answers: Record<string, { location: string | null; asn: number | null; org: string | null; country: string | null } | null> = {
      'https://a.example': { location: 'Frankfurt am Main, DE', asn: 14061, org: 'DigitalOcean, LLC', country: 'DE' },
      'https://b.example': { location: null, asn: null, org: null, country: null },
    }
    const stats = await run(async u => answers[u] ?? null)
    expect(stats).toEqual({ checked: 2, changed: 0 })
    const net = query.mock.calls.filter(c => String(c[0]).startsWith('UPDATE mints SET net_asn'))
    expect(net.map(c => c[1])).toEqual([[14061, 'DigitalOcean, LLC', 'DE', 'https://a.example']])
  })
})

describe('parseIpinfoOrg', () => {
  it('splits "AS14061 DigitalOcean, LLC" and rejects anything else', async () => {
    const { parseIpinfoOrg } = await import('../prober.js')
    expect(parseIpinfoOrg('AS14061 DigitalOcean, LLC')).toEqual({ asn: 14061, org: 'DigitalOcean, LLC' })
    expect(parseIpinfoOrg('AS13335')).toEqual({ asn: 13335, org: null })
    expect(parseIpinfoOrg('DigitalOcean')).toEqual({ asn: null, org: null })
    expect(parseIpinfoOrg(42)).toEqual({ asn: null, org: null })
    expect(parseIpinfoOrg('AS99999999999 X')).toEqual({ asn: null, org: 'X' })
    expect(parseIpinfoOrg(`AS1 ${'x'.repeat(200)}`).org?.length).toBe(80)
  })
})
