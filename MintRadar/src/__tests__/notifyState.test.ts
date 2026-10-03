import { describe, it, expect } from 'vitest'
import { confirmedNotify } from '@/utils/notifyState'

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
