import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrustMoversPanel, type TrustMoversData } from '../components/stats/TrustMoversPanel'

const sample: TrustMoversData = {
  risers: [{ url: 'https://riser.example.com', name: 'Riser Mint', delta: 12 }],
  fallers: [{ url: 'https://faller.example.com', name: 'Faller Mint', delta: -9 }],
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof TrustMoversPanel>> = {}) {
  const onPeriodChange = vi.fn()
  const onMintClick = vi.fn()
  render(
    <TrustMoversPanel
      period="7d"
      onPeriodChange={onPeriodChange}
      data={sample}
      onMintClick={onMintClick}
      getDisplayName={m => m.name ?? m.url}
      {...overrides}
    />
  )
  return { onPeriodChange, onMintClick }
}

describe('TrustMoversPanel', () => {
  describe('7d/30d toggle', () => {
    it('marks the current period button active', () => {
      renderPanel({ period: '30d' })
      expect(screen.getByRole('button', { name: '30d' })).toHaveClass('active')
      expect(screen.getByRole('button', { name: '7d' })).not.toHaveClass('active')
    })

    it('calls onPeriodChange with the clicked period', () => {
      const { onPeriodChange } = renderPanel({ period: '7d' })
      fireEvent.click(screen.getByRole('button', { name: '30d' }))
      expect(onPeriodChange).toHaveBeenCalledWith('30d')
    })

    it('does not call onPeriodChange when clicking the already-active period', () => {
      const { onPeriodChange } = renderPanel({ period: '7d' })
      fireEvent.click(screen.getByRole('button', { name: '7d' }))
      expect(onPeriodChange).toHaveBeenCalledWith('7d')
    })
  })

  describe('empty state', () => {
    it('shows "No significant changes this period" under Risers when risers is empty', () => {
      renderPanel({ data: { risers: [], fallers: sample.fallers } })
      const messages = screen.getAllByText('No significant changes this period')
      expect(messages).toHaveLength(1)
    })

    it('shows "No significant changes this period" under Fallers when fallers is empty', () => {
      renderPanel({ data: { risers: sample.risers, fallers: [] } })
      const messages = screen.getAllByText('No significant changes this period')
      expect(messages).toHaveLength(1)
    })

    it('shows the empty message twice when both risers and fallers are empty (stable network)', () => {
      renderPanel({ data: { risers: [], fallers: [] } })
      expect(screen.getAllByText('No significant changes this period')).toHaveLength(2)
    })

    it('shows "No data yet" (not the empty-network message) while data is still loading', () => {
      renderPanel({ data: undefined })
      expect(screen.getAllByText('No data yet')).toHaveLength(2)
      expect(screen.queryByText('No significant changes this period')).not.toBeInTheDocument()
    })
  })

  describe('riser/faller color differentiation', () => {
    it('gives a riser delta the "up" class and a "+" prefix', () => {
      renderPanel()
      const delta = screen.getByText('+12%')
      expect(delta).toHaveClass('stats-movers-delta', 'up')
      expect(delta).not.toHaveClass('down')
    })

    it('gives a faller delta the "down" class with no "+" prefix (negative sign is native)', () => {
      renderPanel()
      const delta = screen.getByText('-9%')
      expect(delta).toHaveClass('stats-movers-delta', 'down')
      expect(delta).not.toHaveClass('up')
    })
  })

  describe('mint click / display name', () => {
    it('calls onMintClick with the mint url when a row is clicked', () => {
      const { onMintClick } = renderPanel()
      fireEvent.click(screen.getByText('Riser Mint'))
      expect(onMintClick).toHaveBeenCalledWith('https://riser.example.com')
    })

    it('uses getDisplayName to render the row label', () => {
      renderPanel({ getDisplayName: () => 'Custom Label' })
      expect(screen.getAllByText('Custom Label')).toHaveLength(2)
    })
  })
})
