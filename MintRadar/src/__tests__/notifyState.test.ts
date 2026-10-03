import { describe, it, expect } from 'vitest'
import { confirmedNotify, hasLegacyUnconfirmedFlag } from '@/utils/notifyState'

describe('confirmedNotify', () => {
  it('counts the flags only when the server confirmed them', () => {
    expect(confirmedNotify({ notifyOnDown: true, notifyOnUp: false, notifyConfirmedAt: new Date() })).toEqual({ down: true, up: false })
    expect(confirmedNotify({ notifyOnDown: true, notifyOnUp: true, notifyConfirmedAt: new Date() })).toEqual({ down: true, up: true })
  })
  it('treats unconfirmed (legacy) flags as off', () => {
    expect(confirmedNotify({ notifyOnDown: true, notifyOnUp: true })).toEqual({ down: false, up: false })
  })
  it('is off for a missing entry', () => {
    expect(confirmedNotify(undefined)).toEqual({ down: false, up: false })
    expect(confirmedNotify(null)).toEqual({ down: false, up: false })
  })
})

describe('hasLegacyUnconfirmedFlag', () => {
  const confirmed = new Date()
  it('is true for a flag that is on locally without a server confirmation', () => {
    expect(hasLegacyUnconfirmedFlag([{ notifyOnDown: true, notifyOnUp: false }])).toBe(true)
    expect(hasLegacyUnconfirmedFlag([{ notifyOnDown: false, notifyOnUp: true }, { notifyOnDown: false, notifyOnUp: false }])).toBe(true)
  })
  it('is false for new rows (both off), confirmed rows, and an empty list', () => {
    expect(hasLegacyUnconfirmedFlag([])).toBe(false)
    expect(hasLegacyUnconfirmedFlag([{ notifyOnDown: false, notifyOnUp: false }])).toBe(false)
    expect(hasLegacyUnconfirmedFlag([{ notifyOnDown: true, notifyOnUp: true, notifyConfirmedAt: confirmed }])).toBe(false)
    expect(hasLegacyUnconfirmedFlag([{ notifyOnDown: false, notifyOnUp: false, notifyConfirmedAt: confirmed }])).toBe(false)
  })
})
