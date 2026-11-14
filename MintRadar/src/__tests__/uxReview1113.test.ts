import { describe, it, expect } from 'vitest'
import { uptime30dOutageNote } from '@/utils/mintDetailFacts'

describe('uptime30dOutageNote: a rounded 100 % that still had outages', () => {
  it('adds the outage count only next to 100 %', () => {
    expect(uptime30dOutageNote(100, 1)).toBe(' · 1 outage')
    expect(uptime30dOutageNote(100, 3)).toBe(' · 3 outages')
    expect(uptime30dOutageNote(100, 0)).toBe('')
    expect(uptime30dOutageNote(100, undefined)).toBe('')
    expect(uptime30dOutageNote(99, 2)).toBe('')
    expect(uptime30dOutageNote(null, 2)).toBe('')
  })
})
