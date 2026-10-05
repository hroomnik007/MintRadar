import { describe, it, expect } from 'vitest'
import { isNotRecommendedMint, partitionNotRecommended } from '@/utils/notRecommended'

const m = (url: string, extra: { demoNotice?: boolean } = {}) => ({ url, ...extra })

describe('isNotRecommendedMint', () => {
  it('flags curated test mints', () => {
    expect(isNotRecommendedMint(m('https://testnut.cashu.space'))).toBe(true)
    expect(isNotRecommendedMint(m('https://testnut.cashu.space/'))).toBe(true)
  })
  it('flags demo-notice mints', () => {
    expect(isNotRecommendedMint(m('https://demo.example', { demoNotice: true }))).toBe(true)
  })
  it('does not flag normal mints', () => {
    expect(isNotRecommendedMint(m('https://mint.minibits.cash/Bitcoin'))).toBe(false)
    expect(isNotRecommendedMint(m('https://a.example', { demoNotice: false }))).toBe(false)
  })
})

describe('partitionNotRecommended', () => {
  const list = [
    m('https://testnut.cashu.space'), m('https://a.example'), m('https://demo.example', { demoNotice: true }),
    m('https://b.example'), m('https://c.example'), m('https://rugs.cashu.exchange'),
  ]
  it('puts not-recommended mints last and keeps relative order in both groups (stable)', () => {
    expect(partitionNotRecommended(list).map(x => x.url)).toEqual([
      'https://a.example', 'https://b.example', 'https://c.example',
      'https://testnut.cashu.space', 'https://demo.example', 'https://rugs.cashu.exchange',
    ])
  })
  it('is applied after the sort and direction flip, so reversing keeps them last', () => {
    const reversed = [...list].reverse()
    const out = partitionNotRecommended(reversed).map(x => x.url)
    expect(out.slice(0, 3)).toEqual(['https://c.example', 'https://b.example', 'https://a.example'])
    expect(out.slice(3)).toEqual(['https://rugs.cashu.exchange', 'https://demo.example', 'https://testnut.cashu.space'])
  })
  it('does not mutate the input and handles an empty list', () => {
    const copy = [...list]
    partitionNotRecommended(list)
    expect(list).toEqual(copy)
    expect(partitionNotRecommended([])).toEqual([])
  })
  it('a slice taken after the partition never lets a not-recommended mint ahead of a normal one', () => {
    const page1 = partitionNotRecommended(list).slice(0, 3)
    expect(page1.every(x => !isNotRecommendedMint(x))).toBe(true)
  })
})
