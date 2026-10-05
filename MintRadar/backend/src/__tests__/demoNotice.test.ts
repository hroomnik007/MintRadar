import { describe, it, expect } from 'vitest'
import { detectDemoNotice, DEMO_NOTICE_PHRASES } from '../shared/demoNotice.js'

describe('detectDemoNotice (backend)', () => {
  it('matches the LNpay-style notice', () => {
    expect(detectDemoNotice(['This mint is for demonstration purposes only.'])).toBe('for demonstration purposes')
  })
  it('matches every listed phrase case-insensitively and returns the list phrase', () => {
    for (const p of DEMO_NOTICE_PHRASES) expect(detectDemoNotice([`Note: ${p.toUpperCase()}.`])).toBe(p)
  })
  it('does not match generic disclaimers', () => {
    expect(detectDemoNotice(['No guarantee. Without guarantee.'])).toBeNull()
  })
  it('does not match a normal description or empty input', () => {
    expect(detectDemoNotice(['Fast private ecash mint.'])).toBeNull()
    expect(detectDemoNotice([null, undefined, ''])).toBeNull()
  })
  it('only matches whole phrases', () => {
    expect(detectDemoNotice(['mydemo mint'])).toBeNull()
    expect(detectDemoNotice(['demo minted'])).toBeNull()
  })
})
