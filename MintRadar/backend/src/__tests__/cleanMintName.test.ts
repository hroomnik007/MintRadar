import { describe, it, expect } from 'vitest'
import { cleanMintName, cleanMintNameDetailed, MAX_NAME_GRAPHEMES } from '../shared/cleanMintName.js'

const HOST = 'https://mint.example.com'
const cp = (...n: number[]) => String.fromCodePoint(...n)
const ZWSP = cp(0x200b), ZWNJ = cp(0x200c), ZWJ = cp(0x200d), BOM = cp(0xfeff), WJ = cp(0x2060)
const RLO = cp(0x202e), LRI = cp(0x2066), PDI = cp(0x2069), LRM = cp(0x200e)
const VS16 = cp(0xfe0f), VS15 = cp(0xfe0e), VS_SUP = cp(0xe0100), TAG = cp(0xe0041)
const FIRE = cp(0x1f525)

describe('cleanMintName', () => {
  it('leaves normal names unchanged (plain, accented, CJK, punctuation, real names from the mocks)', () => {
    for (const n of ['Minibits', 'Alpha Mint', 'Cashu test mint', 'Café Éclair', 'Mint-o-Matic (EU) #1', '日本語ミント', 'منعنان', "O'Brien's Mint & Co."]) {
      expect(cleanMintName(n, HOST)).toBe(n)
      expect(cleanMintNameDetailed(n, HOST).full).toBeNull()
    }
  })
  it('normalises to NFC', () => {
    expect(cleanMintName('Café', HOST)).toBe('Café')
  })
  it('removes control characters', () => {
    expect(cleanMintName('Mi\u0000n\u0007t\u001b[31m', HOST)).toBe('Mint[31m')
    expect(cleanMintName('a\u007fb\u0085c', HOST)).toBe('abc')
  })
  it('removes zero-width, invisible and word-joiner characters', () => {
    expect(cleanMintName(`a${ZWSP}b${ZWNJ}c${ZWJ}d${BOM}e${WJ}f`, HOST)).toBe('abcdef')
  })
  it('removes bidi marks, overrides and isolates', () => {
    expect(cleanMintName(`${RLO}evil${LRI}x${PDI}${LRM}`, HOST)).toBe('evilx')
  })
  it('removes variation-selector abuse but keeps one emoji presentation selector', () => {
    expect(cleanMintName(`a${VS16}${VS16}${VS16}b`, HOST)).toBe(`a${VS16}b`)
    expect(cleanMintName(`${VS_SUP}x${VS_SUP}${VS_SUP}`, HOST)).toBe('x')
    expect(cleanMintName(`${VS16}${VS15}name`, HOST)).toBe('name')
    expect(cleanMintName(`${TAG}tag`, HOST)).toBe('tag')
    expect(cleanMintName(`❤${VS16} love`, HOST)).toBe(`❤${VS16} love`)
  })
  it('collapses whitespace and trims', () => {
    expect(cleanMintName(`  two \t\n  spaces${cp(0xa0)}here  `, HOST)).toBe('two spaces here')
  })
  it('caps more than 3 consecutive emoji at 3 and keeps the full cleaned name for a tooltip', () => {
    const r = cleanMintNameDetailed(`${FIRE.repeat(7)} hot`, HOST)
    expect(r.name).toBe(`${FIRE.repeat(3)} hot`)
    expect(r.full).toBe(`${FIRE.repeat(7)} hot`)
    expect(cleanMintName(`${FIRE.repeat(3)} ok`, HOST)).toBe(`${FIRE.repeat(3)} ok`)
    // runs separated by text are separate runs
    expect(cleanMintName(`${FIRE.repeat(3)}x${FIRE.repeat(3)}`, HOST)).toBe(`${FIRE.repeat(3)}x${FIRE.repeat(3)}`)
  })
  it('truncates to 48 grapheme clusters with an ellipsis and keeps the full name', () => {
    const long = 'x'.repeat(100)
    const r = cleanMintNameDetailed(long, HOST)
    expect([...new Intl.Segmenter().segment(r.name)].length).toBe(MAX_NAME_GRAPHEMES)
    expect(r.name.endsWith('…')).toBe(true)
    expect(r.full).toBe(long)
    const exact = 'y'.repeat(48)
    expect(cleanMintName(exact, HOST)).toBe(exact)
  })
  it('counts grapheme clusters, not code units (combining marks and emoji sequences are one)', () => {
    const name = 'é'.repeat(48)
    expect(cleanMintName(name, HOST)).toBe(name.normalize('NFC'))
  })
  it('uses the hostname when nothing displayable is left', () => {
    expect(cleanMintName('', HOST)).toBe('mint.example.com')
    expect(cleanMintName(null, HOST)).toBe('mint.example.com')
    expect(cleanMintName(undefined, HOST)).toBe('mint.example.com')
    expect(cleanMintName(`${ZWSP}${ZWSP}  ${RLO}`, HOST)).toBe('mint.example.com')
    expect(cleanMintName('   ', 'not a url')).toBe('not a url')
  })
  it('returns an empty name (no host fallback) when no url is given', () => {
    expect(cleanMintNameDetailed(ZWSP, '').name).toBe('')
  })
  it('is idempotent', () => {
    for (const n of [`${FIRE.repeat(9)} z`, 'x'.repeat(200), 'Café', `a${VS16}${VS16}b`]) {
      const once = cleanMintName(n, HOST)
      expect(cleanMintName(once, HOST)).toBe(once)
    }
  })
})
