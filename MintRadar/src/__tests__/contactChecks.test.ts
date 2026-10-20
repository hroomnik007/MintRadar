import { describe, it, expect } from 'vitest'
import { contactChecksLine, contactChecksText, readContactChecks, type ContactCheckFact } from '@/utils/contactChecks'

// The "Contact checks" line of Mint Detail: neutral facts only, built from the stored results (never a value).
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const AT = new Date(NOW - 3 * 60_000).toISOString()
const c = (kind: string, formatValid: boolean, domainResolves: boolean | null = null): ContactCheckFact => ({ kind, formatValid, domainResolves, checkedAt: AT })
const text = (checks: ContactCheckFact[]) => contactChecksText(contactChecksLine(checks, NOW)!)

describe('contactChecksLine', () => {
  it('no checks, no line', () => {
    expect(contactChecksLine([], NOW)).toBeNull()
    expect(contactChecksLine(undefined, NOW)).toBeNull()
    expect(contactChecksLine(null, NOW)).toBeNull()
  })

  it('all valid: e-mail with mail records and a Nostr key', () => {
    expect(text([c('email', true, true), c('nostr', true)])).toBe('Contact checks: email format valid, domain has mail records · Nostr key valid · checked 3 min ago')
  })

  it('an invalid e-mail format says so and states nothing about the domain', () => {
    expect(text([c('email', false)])).toBe('Contact checks: email format not valid · checked 3 min ago')
  })

  it('an unknown DNS result is "inconclusive", never "no mail records"', () => {
    const t = text([c('email', true, null)])
    expect(t).toBe('Contact checks: email format valid, domain lookup inconclusive · checked 3 min ago')
    expect(t).not.toContain('no mail records')
  })

  it('DNS said there are no records: stated as a fact', () => {
    expect(text([c('email', true, false)])).toContain('domain has no mail records')
  })

  it('several entries of one kind are counted, not repeated', () => {
    expect(text([c('email', true, true), c('email', true, false), c('email', false)])).toBe(
      'Contact checks: email format valid for 2 of 3, 1 of 2 domains have mail records · checked 3 min ago')
    expect(text([c('email', true, true), c('email', true, true)])).toContain('domains have mail records')
    expect(text([c('email', true, true), c('email', true, null)])).toContain('1 of 2 domains have mail records, 1 lookup inconclusive')
  })

  it('every other kind has a label; an unknown kind reads as "other"; the order is fixed', () => {
    expect(text([c('url', true), c('twitter', false), c('telegram', true), c('signal', true), c('x', true), c('weird', true), c('nostr', false)])).toBe(
      'Contact checks: Nostr key not valid · Twitter format not valid · X format valid · Telegram format valid · Signal format valid · website URL valid · other entry format valid · checked 3 min ago')
  })

  it('the time label is relative and the title is the absolute UTC time', () => {
    const line = contactChecksLine([c('nostr', true)], NOW)!
    expect(line.checked?.label).toBe('3 min ago')
    expect(line.checked?.title).toMatch(/UTC$/)
  })

  it('no verdict words, whatever the facts', () => {
    const all = [text([c('email', true, true), c('nostr', true)]), text([c('email', false)]), text([c('email', true, false), c('url', false)])].join(' ')
    expect(all).not.toMatch(/verified|trusted|trust|fake|safe|legit|scam|genuine/i)
  })
})

describe('readContactChecks', () => {
  it('keeps well-formed entries and drops the rest; anything but an array is empty', () => {
    expect(readContactChecks(undefined)).toEqual([])
    expect(readContactChecks({ a: 1 })).toEqual([])
    expect(readContactChecks([c('email', true, null), { kind: 'email' }, null, 'x', { ...c('nostr', true), formatValid: 'yes' }, { ...c('x', true), domainResolves: 'maybe' }]))
      .toEqual([c('email', true, null)])
  })
  it('a value-like extra field is not carried over', () => {
    const [e] = readContactChecks([{ ...c('email', true, true), value: 'a@b.com', domain: 'b.com' }])
    expect(Object.keys(e!).sort()).toEqual(['checkedAt', 'domainResolves', 'formatValid', 'kind'])
  })
})
