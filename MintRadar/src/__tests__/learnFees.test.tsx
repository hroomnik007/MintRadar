// Learn module 4 "Fees" section (2026-10-27): the input fee is per coin, the Lightning fee reserve applies on melt,
// and each mint's "Fees and limits" card (NUTs tab of the mint page) is where the numbers are.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Module4 from '@/pages/learn/Module4'

describe('Learn module 4: Fees section', () => {
  it('has a Fees heading after "Sending and receiving tokens" and before the backup section', () => {
    render(<MemoryRouter><Module4 /></MemoryRouter>)
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    const i = headings.indexOf('Fees')
    expect(i).toBeGreaterThan(headings.indexOf('Sending and receiving tokens'))
    expect(i).toBeLessThan(headings.indexOf('Backing up your wallet'))
  })

  it('states the per-coin input fee, the melt fee reserve and where to see them', () => {
    const { container } = render(<MemoryRouter><Module4 /></MemoryRouter>)
    const text = container.textContent ?? ''
    expect(text).toMatch(/input fee for each coin you spend/)
    expect(text).toMatch(/many small coins costs more/)
    expect(text).toMatch(/withdraw to Lightning \(melt\).*Lightning fee reserve/)
    expect(text).toMatch(/Fees and limits card on the NUTs tab/)
    // No longer claims sending is simply "free".
    expect(text).not.toMatch(/instant and free/)
  })
})
