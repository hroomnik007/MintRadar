import { describe, it, expect } from 'vitest'
import { cleanMintName, cleanMintNameDetailed } from '@/utils/cleanMintName'
import { displayName, shouldShowHostLine, computeDuplicateMintNames } from '@/utils/mintFormatting'

const cp = (...n: number[]) => String.fromCodePoint(...n)
const URL_ = 'https://mint.example.com'

describe('cleanMintName (frontend copy)', () => {
  it('leaves normal names unchanged', () => {
    for (const n of ['Minibits', 'Alpha Mint', 'Cashu test mint', 'Café', '日本語']) expect(cleanMintName(n, URL_)).toBe(n)
  })
  it('strips invisible and bidi characters, caps emoji and length, falls back to the host', () => {
    expect(cleanMintName(`${cp(0x202e)}a${cp(0x200b)}b`, URL_)).toBe('ab')
    expect(cleanMintNameDetailed(`${cp(0x1f525).repeat(6)}`, URL_).name).toBe(cp(0x1f525).repeat(3))
    expect(cleanMintNameDetailed('x'.repeat(100), URL_).full).toBe('x'.repeat(100))
    expect(cleanMintName(cp(0x200b), URL_)).toBe('mint.example.com')
  })
})

describe('displayName applies the cleaning', () => {
  it('shows the cleaned name', () => {
    expect(displayName({ name: `${cp(0x202e)}Evil${cp(0x200b)} Mint`, url: URL_ })).toBe('Evil Mint')
    expect(displayName({ name: `${cp(0x1f525).repeat(8)} Hot`, url: URL_ })).toBe(`${cp(0x1f525).repeat(3)} Hot`)
  })
  it('a name with nothing displayable left falls back to the hostname, flagged as a fallback (no duplicate host line)', () => {
    const m = { name: cp(0x200b, 0x200b), url: URL_ }
    expect(displayName(m)).toBe('mint.example.com')
    expect(shouldShowHostLine(m)).toBe(false)
  })
  it('a null name (e.g. a hidden-list mint from the backend) shows the hostname without a duplicate host line', () => {
    const m = { name: null, url: 'https://mint.sortug.com' }
    expect(displayName(m)).toBe('mint.sortug.com')
    expect(shouldShowHostLine(m)).toBe(false)
  })
  it('duplicate-name detection works on cleaned names', () => {
    const dup = computeDuplicateMintNames([{ name: `a${cp(0x200b)}b` }, { name: 'AB' }])
    expect(dup.has('ab')).toBe(true)
  })
})
