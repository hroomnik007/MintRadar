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

// D4 (UI/UX report 2026-11-22): one name per tracked NUT on Stats, the NUT dialogs and the NUTs tab.
describe('one name per tracked NUT', () => {
  it('NUT_META, NUT_DESCRIPTIONS and NUT_GROUPS use NUT_NAMES', async () => {
    const { NUT_META, NUT_NAMES, TRACKED_NUTS: tracked } = await import('@/constants/nuts')
    const { NUT_DESCRIPTIONS, NUT_GROUPS: groups } = await import('@/pages/mintDetail/nutCatalog')
    const inGroups = new Map(groups.flatMap(g => g.nuts.map(n => [n.nut, n.name] as const)))
    for (const nut of tracked) {
      const name = NUT_NAMES[nut]
      expect(name, nut).toBeTruthy()
      expect(NUT_META[nut]?.short, nut).toBe(name)
      expect(NUT_DESCRIPTIONS[nut]?.short, nut).toBe(name)
      expect(inGroups.get(nut), nut).toBe(name)
    }
  })
})
