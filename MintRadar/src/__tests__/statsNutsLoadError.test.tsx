// The Stats page and the NUT Explorer show the shared LoadError (a fixed sentence and "Try again") when their own
// data does not load, never a raw error message, and "Try again" requests the data again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/hooks/useNostrDiscovery', () => ({ useNostrDiscovery: () => undefined }))

import Stats from '@/pages/Stats'
import NutExplorer from '@/pages/NutExplorer'

type Mode = '500' | 'network' | 'ok'
const state = { stats: '500' as Mode, nuts: '500' as Mode, calls: { stats: 0, nuts: 0 } }

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  state.stats = '500'; state.nuts = '500'; state.calls = { stats: 0, nuts: 0 }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const key = url === '/api/stats' ? 'stats' : url === '/api/nuts' ? 'nuts' : null
    if (key) {
      state.calls[key]++
      const mode = state[key]
      if (mode === 'network') throw new TypeError('secret-internal-detail: connection refused')
      if (mode === '500') return new Response(JSON.stringify({ error: 'secret-internal-detail' }), { status: 500 })
      return new Response(JSON.stringify([]), { status: 200 })
    }
    return new Response('[]', { status: 500 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function renderPage(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>)
}

for (const mode of ['500', 'network'] as const) {
  describe(`Stats, ${mode}`, () => {
    it('shows the fixed sentence with Try again, no raw error text, and Try again requests /api/stats again', async () => {
      state.stats = mode
      renderPage(<Stats />)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not load the statistics. Please try again.')
      expect(document.body.textContent).not.toContain('secret-internal-detail')
      expect(document.body.textContent).not.toContain('Failed to load')
      expect(screen.getByText('Statistics')).toBeInTheDocument()
      const before = state.calls.stats
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(state.calls.stats).toBe(before + 1))
    })
  })
  describe(`NUT Explorer, ${mode}`, () => {
    it('shows the fixed sentence with Try again and, once healthy, the content instead of the alert', async () => {
      state.nuts = mode
      const { container } = renderPage(<NutExplorer />)
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not load the NUT data. Please try again.')
      expect(document.body.textContent).not.toContain('secret-internal-detail')
      expect(document.body.textContent).not.toContain('Failed to load')
      expect(screen.getByText('NUT Explorer')).toBeInTheDocument()
      state.nuts = 'ok'
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(container.querySelector('.nuts-grid')).not.toBeNull())
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
}
