import { describe, it, expect } from 'vitest'
import { detectDemoNotice, DEMO_NOTICE_PHRASES } from '@/utils/demoNotice'

describe('detectDemoNotice', () => {
  it('matches the LNpay-style notice', () => {
    expect(detectDemoNotice(['This mint is run for demonstration purposes only. Do not use it for real sats.']))
      .toBeNull()
  })
  it('returns the list phrase (not mint text) and at most 60 characters', () => {
    for (const p of DEMO_NOTICE_PHRASES) {
      const r = detectDemoNotice([`xx ${p.toUpperCase()} yy`])
      expect(r).toBe(p)
      expect(r!.length).toBeLessThanOrEqual(60)
    }
  })
  it('does not match generic disclaimers real mints use', () => {
    expect(detectDemoNotice(['No guarantee.'])).toBeNull()
    expect(detectDemoNotice(['Provided without guarantee, use at your own risk, still in development.'])).toBeNull()
  })
  it('does not match a normal description', () => {
    expect(detectDemoNotice(['Minibits mint. Fast, private ecash for everyday use.'])).toBeNull()
  })
  it('scans all inputs and ignores null/undefined', () => {
    expect(detectDemoNotice([undefined, 'fine', null, 'This is a test mint'])).toBe('test mint')
  })
  it('bounds the scanned text', () => {
    const big = 'a '.repeat(10_000) + 'demo mint'
    expect(detectDemoNotice([big])).toBeNull()
  })
})
