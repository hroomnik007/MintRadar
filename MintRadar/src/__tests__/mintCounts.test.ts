import { describe, it, expect } from 'vitest'
import { trackedCount, onlineCount, isPoolHidden, hiddenByDefaultCount, poolForStatus } from '@/utils/mintCounts'

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
  it('status all and offline hide nothing', () => {
    expect(hiddenByDefaultCount(fixture, 'all')).toBe(0)
    expect(hiddenByDefaultCount(fixture, 'offline')).toBe(0)
  })
  it('pool per status: all = every tracked mint, offline reveals hidden, online strips them', () => {
    expect(poolForStatus(fixture, 'all', false)).toHaveLength(trackedCount(fixture))
    expect(poolForStatus(fixture, 'offline', false)).toHaveLength(trackedCount(fixture))
    expect(poolForStatus(fixture, 'online', false)).toHaveLength(5)
    expect(poolForStatus(fixture, 'online', true)).toHaveLength(trackedCount(fixture))
  })
  it('draft count per status (pool + status predicate): all 9, online 3, offline 5', () => {
    const count = (status: 'all' | 'online' | 'offline') => poolForStatus(fixture, status, false)
      .filter(m => status === 'all' || (status === 'online' ? m.online === true : m.online === false)).length
    expect(count('all')).toBe(9)
    expect(count('online')).toBe(3)
    expect(count('offline')).toBe(5)
  })
})
