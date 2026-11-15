import { describe, it, expect } from 'vitest'
import { shortNpub, avatarInitial } from '@/utils/npub'

const NPUB = 'npub1dx2xvq8hkq4h3lk9n2v6s7u0yq5w3e4r5t6y7u8i9o0p1a2s3d4fuc2f'

describe('shortNpub', () => {
  it('keeps the head and tail of an npub with one ellipsis character', () => {
    expect(shortNpub(NPUB)).toBe(`${NPUB.slice(0, 12)}…${NPUB.slice(-6)}`)
    expect(shortNpub(NPUB)).toMatch(/^npub1.{7}….{6}$/)
  })
  it('returns short input unchanged', () => {
    expect(shortNpub('npub1short')).toBe('npub1short')
  })
})

describe('avatarInitial', () => {
  it('uses the first grapheme of a name, uppercased', () => {
    expect(avatarInitial('peter')).toBe('P')
    expect(avatarInitial('  ľubo')).toBe('Ľ')
    expect(avatarInitial('👍🏽 fan')).toBe('👍🏽')
  })
  it('gives null for no name or an npub, so the avatar shows an icon instead of "N"', () => {
    expect(avatarInitial(null)).toBeNull()
    expect(avatarInitial('   ')).toBeNull()
    expect(avatarInitial(NPUB)).toBeNull()
  })
})
