import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  loadHiddenMintNames, publicMintName, publicMintNameOrHost, isHiddenMintName, normalizeMintUrl,
  _setHiddenMintNamesForTest, MAX_HIDDEN_MINT_NAMES,
} from '../mintNames.js'
import seed from '../data/hiddenMintNames.json'

afterEach(() => { _setHiddenMintNamesForTest(loadHiddenMintNames(seed)) })

describe('loadHiddenMintNames', () => {
  it('loads valid entries and normalises the url', () => {
    const m = loadHiddenMintNames([{ url: 'https://Mint.Example.com/', reason: 'spam' }])
    expect([...m]).toEqual([['https://mint.example.com', 'spam']])
  })
  it('ignores invalid entries and reports them', () => {
    const warn = vi.fn()
    const m = loadHiddenMintNames([
      null, 'x', 42, {}, { url: 'https://a.example' }, { url: 'https://a.example', reason: '' }, { url: 'nope', reason: 'r' },
      { url: 'http://insecure.example', reason: 'r' }, { url: 'https://long.example', reason: 'r'.repeat(201) },
      { url: 'https://ok.example', reason: 'fine' },
    ], warn)
    expect([...m.keys()]).toEqual(['https://ok.example'])
    expect(warn).toHaveBeenCalledTimes(9)
  })
  it('ignores a non-array file, duplicates, and everything past 200 entries', () => {
    expect(loadHiddenMintNames({ url: 'https://a.example', reason: 'r' }).size).toBe(0)
    const dup = loadHiddenMintNames([{ url: 'https://a.example', reason: 'first' }, { url: 'https://a.example/', reason: 'second' }])
    expect([...dup]).toEqual([['https://a.example', 'first']])
    const many = Array.from({ length: 250 }, (_, i) => ({ url: `https://m${i}.example`, reason: 'r' }))
    expect(loadHiddenMintNames(many).size).toBe(MAX_HIDDEN_MINT_NAMES)
  })
  it('the seed file is valid and lists mint.sortug.com', () => {
    const warn = vi.fn()
    const m = loadHiddenMintNames(seed, warn)
    expect(warn).not.toHaveBeenCalled()
    expect(m.get('https://mint.sortug.com')).toMatch(/vulgar/)
  })
})

describe('publicMintName', () => {
  it('cleans a normal name and leaves the tooltip empty', () => {
    expect(publicMintName('Alpha Mint', 'https://alpha.example')).toEqual({ name: 'Alpha Mint', nameFull: null })
  })
  it('returns the full name for a truncated one', () => {
    const r = publicMintName('x'.repeat(80), 'https://a.example')
    expect(r.name!.length).toBeLessThan(80)
    expect(r.nameFull).toBe('x'.repeat(80))
  })
  it('a hidden mint shows no name at all and never exposes the raw one (any url spelling)', () => {
    for (const url of ['https://mint.sortug.com', 'https://mint.sortug.com/', 'https://MINT.sortug.com']) {
      expect(isHiddenMintName(url)).toBe(true)
      expect(publicMintName('Very Rude Name', url)).toEqual({ name: null, nameFull: null })
      expect(publicMintNameOrHost('Very Rude Name', url)).toBe('mint.sortug.com')
    }
    expect(isHiddenMintName('https://other.sortug.com')).toBe(false)
  })
  it('nothing displayable means null (the client shows the hostname)', () => {
    expect(publicMintName(null, 'https://a.example')).toEqual({ name: null, nameFull: null })
    expect(publicMintName(String.fromCharCode(0x200b, 0x200b), 'https://a.example')).toEqual({ name: null, nameFull: null })
    expect(publicMintNameOrHost('', 'https://a.example')).toBe('a.example')
  })
  it('honours a replaced list (test hook)', () => {
    _setHiddenMintNamesForTest(new Map([[normalizeMintUrl('https://x.example/'), 'r']]))
    expect(publicMintName('Name', 'https://x.example').name).toBeNull()
    expect(publicMintName('Name', 'https://mint.sortug.com').name).toBe('Name')
  })
})
