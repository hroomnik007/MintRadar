import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { NutsTab } from '@/pages/mintDetail/NutsTab'
import { NUTZAP_NUTS_NOTE, nutzapNote } from '@/utils/mintDetailFacts'

const NOW = Date.parse('2026-10-30T12:00:00Z')

describe('nutzap sentence under the NUT grid: source and time', () => {
  it('names /v1/info and the time of the latest successful fetch', () => {
    const n = nutzapNote('2026-10-30T11:55:00Z', NOW)
    expect(n.lead).toBe("NUT-07, NUT-10, NUT-11 and NUT-12 are the ones nutzaps (NIP-61) rely on · from the mint's /v1/info")
    expect(n.time).toEqual({ label: '5 min ago', title: '30 Oct 2026, 11:55 UTC' })
  })
  it('without a usable time the source stays and the time is left out', () => {
    expect(nutzapNote(null, NOW).time).toBeNull()
    expect(nutzapNote('nope', NOW).time).toBeNull()
  })
  it('renders as one sentence under the grid, the exact time as title, no verdict', () => {
    const { container } = render(
      <NutsTab feesLimits={null} keysetsPanel={null} supportsBackupRestore={false} supportedNuts={['NUT-11']} disabledNuts={[]}
        onSelectNut={() => {}} infoFetchedAt="2026-10-30T09:00:00Z" now={NOW} />,
    )
    const note = container.querySelector('.md-nut-nutzap-note')!
    expect(note.textContent).toBe(`${NUTZAP_NUTS_NOTE} · from the mint's /v1/info, checked 3h ago.`)
    expect(note.querySelector('span')!.getAttribute('title')).toBe('30 Oct 2026, 09:00 UTC')
    expect(note.textContent).not.toMatch(/ready|safe|recommended|trusted|verified/i)
  })
  it('renders without a time as a plain sentence', () => {
    const { container } = render(
      <NutsTab feesLimits={null} keysetsPanel={null} supportsBackupRestore={false} supportedNuts={[]} disabledNuts={[]}
        onSelectNut={() => {}} infoFetchedAt={null} now={NOW} />,
    )
    expect(container.querySelector('.md-nut-nutzap-note')!.textContent).toBe(`${NUTZAP_NUTS_NOTE} · from the mint's /v1/info.`)
  })
})
