import { describe, it, expect } from 'vitest'
import { uptime30dOutageNote } from '@/utils/mintDetailFacts'

describe('uptime30dOutageNote: a 30-day uptime that looks perfect but still had outages', () => {
  it('adds the outage count only next to 99.5 % and above (the figures that used to round to 100 %)', () => {
    expect(uptime30dOutageNote(100, 1)).toBe(' · 1 outage')
    expect(uptime30dOutageNote(100, 3)).toBe(' · 3 outages')
    expect(uptime30dOutageNote(100, 0)).toBe('')
    expect(uptime30dOutageNote(100, undefined)).toBe('')
    expect(uptime30dOutageNote(99.9, 1)).toBe(' · 1 outage')
    expect(uptime30dOutageNote(99.5, 2)).toBe(' · 2 outages')
    expect(uptime30dOutageNote(99.4, 2)).toBe('')
    expect(uptime30dOutageNote(99, 2)).toBe('')
    expect(uptime30dOutageNote(null, 2)).toBe('')
  })
})
