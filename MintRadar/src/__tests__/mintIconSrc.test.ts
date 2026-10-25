import { describe, expect, it } from 'vitest'
import { iconVariantFor, mintIconSrc, mintIconSrcSet } from '@/utils/mintIconSrc'

describe('mintIconSrc', () => {
  it('picks the smallest server variant that covers the device pixels', () => {
    expect(iconVariantFor(14)).toBe(64)
    expect(iconVariantFor(64)).toBe(64)
    expect(iconVariantFor(65)).toBe(128)
    expect(iconVariantFor(128)).toBe(128)
    expect(iconVariantFor(144)).toBeNull()
  })

  it('builds proxy URLs with &s= and the original for null', () => {
    expect(mintIconSrc('https://a.example', 64)).toBe('/api/mint/icon?url=https%3A%2F%2Fa.example&s=64')
    expect(mintIconSrc('https://a.example', null)).toBe('/api/mint/icon?url=https%3A%2F%2Fa.example')
  })

  it('lists 1x/2x/3x candidates (72 px avatar: 128, then the original)', () => {
    const u = '/api/mint/icon?url=https%3A%2F%2Fa.example'
    expect(mintIconSrcSet('https://a.example', 22)).toBe(`${u}&s=64 1x, ${u}&s=64 2x, ${u}&s=128 3x`)
    expect(mintIconSrcSet('https://a.example', 72)).toBe(`${u}&s=128 1x, ${u} 2x, ${u} 3x`)
  })
})
