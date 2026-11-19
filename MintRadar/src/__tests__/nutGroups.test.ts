import { describe, it, expect } from 'vitest'
import { NUT_GROUPS } from '@/pages/mintDetail/nutCatalog'
import { TRACKED_NUTS } from '@/constants/nuts'

describe('NUT groups of the NUTs tab', () => {
  it('cover every tracked NUT exactly once', () => {
    const listed = NUT_GROUPS.flatMap(g => g.nuts.map(n => n.nut))
    expect([...listed].sort()).toEqual([...TRACKED_NUTS].sort())
    expect(new Set(listed).size).toBe(listed.length)
  })
  it('give each one a name and one sentence', () => {
    for (const g of NUT_GROUPS) for (const n of g.nuts) {
      expect(n.name.length).toBeGreaterThan(2)
      expect(n.line).toMatch(/^[A-Z].*\.$/)
    }
  })
})
