import { describe, it, expect } from 'vitest'
import { trackedCount, onlineCount, isPoolHidden, hiddenByDefaultCount } from '@/utils/mintCounts'

const online = { online: true, degraded: false, archived: false }
const test = { online: true, degraded: false, archived: false } // test mints count like any other mint
const offlineRecent = { online: false, degraded: false, archived: false }
const degraded = { online: false, degraded: true, archived: false }
const archived = { online: false, degraded: true, archived: true }
const unknown = { online: null, degraded: false }

const fixture = [online, online, test, offlineRecent, degraded, degraded, archived, archived, unknown]

describe('mintCounts', () => {
  it('tracked = every row, archived included', () => {
    expect(trackedCount(fixture)).toBe(9)
  })
  it('online counts only online === true', () => {
    expect(onlineCount(fixture)).toBe(3)
  })
  it('pool hides degraded and archived', () => {
    expect(fixture.filter(isPoolHidden)).toHaveLength(4)
  })
  it('default view: online + hidden === tracked', () => {
    expect(onlineCount(fixture) + hiddenByDefaultCount(fixture, 'online')).toBe(trackedCount(fixture))
    expect(hiddenByDefaultCount(fixture, 'online')).toBe(6)
  })
  it('status all hides only degraded + archived; offline hides nothing', () => {
    expect(hiddenByDefaultCount(fixture, 'all')).toBe(4)
    expect(hiddenByDefaultCount(fixture, 'offline')).toBe(0)
  })
})
