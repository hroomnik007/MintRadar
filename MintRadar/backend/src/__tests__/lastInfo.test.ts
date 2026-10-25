import { describe, it, expect } from 'vitest'
import { lastInfoOf } from '../lastInfo.js'

describe('lastInfoOf', () => {
  it('returns the stored MOTD and description with the last successful probe as seenAt', () => {
    expect(lastInfoOf({ motd: 'Hello', description: 'Desc' }, '2026-10-24T08:00:00.000Z'))
      .toEqual({ motd: 'Hello', description: 'Desc', seenAt: '2026-10-24T08:00:00.000Z' })
  })

  it('keeps one field when the other is missing or blank', () => {
    expect(lastInfoOf({ motd: '  ', description: 'Desc' }, null)).toEqual({ motd: null, description: 'Desc', seenAt: null })
    expect(lastInfoOf({ motd: 'Hi' }, new Date('2026-10-24T08:00:00.000Z'))).toEqual({ motd: 'Hi', description: null, seenAt: '2026-10-24T08:00:00.000Z' })
  })

  it('is null without a baseline or without both fields', () => {
    expect(lastInfoOf(null, '2026-10-24T08:00:00.000Z')).toBeNull()
    expect(lastInfoOf({ version: 'Nutshell/0.16.0' }, '2026-10-24T08:00:00.000Z')).toBeNull()
    expect(lastInfoOf('not an object', null)).toBeNull()
  })

  it('reads through the change-log sanitiser (no control characters, an invalid time is null)', () => {
    const r = lastInfoOf({ motd: 'a\u0000b' }, 'not a date')
    expect(r?.motd).not.toContain('\u0000')
    expect(r?.seenAt).toBeNull()
  })
})
