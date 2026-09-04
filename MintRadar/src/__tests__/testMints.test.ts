import { describe, it, expect } from 'vitest'
import { isTestMint, TEST_MINT_URLS } from '@/constants/testMints'

describe('isTestMint', () => {
  it('matches known dev/test-only mints', () => {
    expect(isTestMint('https://testnut.cashu.space')).toBe(true)
    expect(isTestMint('https://8333.space:3338')).toBe(true)
  })

  it('does not match real production mints, including ones with risk disclaimers', () => {
    expect(isTestMint('https://mint.minibits.cash/Bitcoin')).toBe(false)
    expect(isTestMint('https://mint.sovran.money')).toBe(false)
    expect(isTestMint('https://mint.example.com')).toBe(false)
  })

  it('tolerates a trailing slash', () => {
    expect(isTestMint('https://testnut.cashu.space/')).toBe(true)
  })

  it('exports a non-empty curated list', () => {
    expect(TEST_MINT_URLS.size).toBeGreaterThan(0)
  })
})
