// The "Compare with..." picker (MintComparePicker.tsx): a keyboard-usable multi-select listbox of real buttons
// (one Tab stop, arrow keys, Enter/Space) that lists every candidate, not only the first 50.
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import type { KnownMint } from '@/hooks/useKnownMints'
import { MintComparePicker } from '@/components/MintComparePicker'

const mint = (i: number): KnownMint => ({
  url: `https://m${String(i).padStart(2, '0')}.mint.example`, name: `Mint ${String(i).padStart(2, '0')}`, iconUrl: null,
  degraded: false, online: true, latencyMs: 50, version: null, nutCount: 0, tosUrl: null, descriptionLong: null,
  nutsLimits: null, units: ['sat'], reliabilityScore: 80, uptimePct24h: 99, uptimePct7d: 99,
  discoveredAt: '2025-09-01T00:00:00.000Z', lastCheckedAt: new Date().toISOString(),
})
const MINTS = Array.from({ length: 60 }, (_, i) => mint(i))

function setup(candidates = MINTS) {
  const onConfirm = vi.fn()
  render(<MintComparePicker candidates={candidates} baseLabel="Base Mint" onClose={() => undefined} onConfirm={onConfirm} />)
  return { onConfirm, options: () => screen.getAllByRole('option') }
}

describe('MintComparePicker', () => {
  it('lists every candidate (no 50 cap) as button options in a multi-select listbox', () => {
    const { options } = setup()
    const listbox = screen.getByRole('listbox', { name: 'Mints to compare' })
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true')
    expect(options()).toHaveLength(60)
    expect(options().every(o => o.tagName === 'BUTTON' && o.getAttribute('type') === 'button')).toBe(true)
    expect(screen.getByText('Mint 59')).toBeTruthy()
  })

  it('has one Tab stop (roving tabindex) and moves with ArrowDown/ArrowUp/Home/End', () => {
    const { options } = setup()
    expect(options().filter(o => o.tabIndex === 0)).toHaveLength(1)
    expect(options()[0]!.tabIndex).toBe(0)
    options()[0]!.focus()
    fireEvent.keyDown(options()[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(options()[1])
    expect(options()[1]!.tabIndex).toBe(0)
    expect(options()[0]!.tabIndex).toBe(-1)
    fireEvent.keyDown(options()[1]!, { key: 'End' })
    expect(document.activeElement).toBe(options()[59])
    fireEvent.keyDown(options()[59]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(options()[59])
    fireEvent.keyDown(options()[59]!, { key: 'Home' })
    expect(document.activeElement).toBe(options()[0])
    fireEvent.keyDown(options()[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(options()[0])
  })

  it('ArrowDown in the search field moves focus into the list', () => {
    const { options } = setup()
    const search = screen.getByRole('textbox', { name: 'Search mints' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(options()[0])
  })

  it('toggles selection with aria-selected and disables the rest after 3 picks', () => {
    const { options, onConfirm } = setup()
    for (const i of [0, 1, 2]) fireEvent.click(options()[i]!)
    expect(options().slice(0, 3).every(o => o.getAttribute('aria-selected') === 'true')).toBe(true)
    expect(options()[3]!.getAttribute('aria-selected')).toBe('false')
    expect(options()[3]!.getAttribute('aria-disabled')).toBe('true')
    // Still focusable (aria-disabled, not native disabled) so arrow keys pass over it, but a click does nothing.
    expect((options()[3] as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(options()[3]!)
    expect(options()[3]!.getAttribute('aria-selected')).toBe('false')
    fireEvent.click(options()[1]!)
    expect(options()[1]!.getAttribute('aria-selected')).toBe('false')
    expect(options()[3]!.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Compare (2)' }))
    expect(onConfirm).toHaveBeenCalledWith([MINTS[0]!.url, MINTS[2]!.url])
  })

  it('shows the empty state outside the listbox when the search matches nothing', () => {
    setup()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search mints' }), { target: { value: 'zzz' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('No mints match your search.')
  })

  it('keeps the Tab stop inside a narrower search result', () => {
    const { options } = setup()
    options()[0]!.focus()
    fireEvent.keyDown(options()[0]!, { key: 'End' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search mints' }), { target: { value: 'Mint 0' } })
    expect(options()).toHaveLength(10)
    expect(options().filter(o => o.tabIndex === 0)).toHaveLength(1)
    expect(options()[9]!.tabIndex).toBe(0)
  })
})
