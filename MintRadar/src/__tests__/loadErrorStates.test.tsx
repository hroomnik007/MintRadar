// An API failure is never presented as a mint state. A failed /api/mints/known shows ONE shared error
// state (LoadError: a fixed sentence + "Try again" that refetches) on Mint Detail, Watchlist and Home, and
// none of them renders a mint card, an "offline" dot, "Not a tracked mint" or the derived "0 online mints" strip.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LoadError, LoadingNote, MINT_LIST_ERROR } from '@/components/LoadError'

const known = vi.hoisted(() => ({
  state: { data: undefined as unknown, isLoading: false, isError: true, error: new Error('secret-internal-detail: pg connection refused'), refetch: vi.fn() },
}))
vi.mock('@/hooks/useKnownMints', () => ({ useKnownMints: () => known.state }))
vi.mock('@/hooks/useNostrDiscovery', () => ({ useNostrDiscovery: () => undefined }))
vi.mock('@/hooks/useFollowRecommendations', () => ({ useFollowRecommendations: () => ({ data: undefined, isLoading: false, isError: false }) }))

import MintDetail from '@/pages/MintDetail'
import Watchlist from '@/pages/Watchlist'
import Dashboard from '@/pages/Dashboard'
import { useAuthStore } from '@/stores/auth.store'
import { useWatchlistStore } from '@/stores/watchlist.store'

beforeEach(() => {
  known.state.data = undefined
  known.state.isLoading = false
  known.state.isError = true
  known.state.refetch = vi.fn()
})

function renderAt(path: string, ui: React.ReactElement, route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={ui} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function expectErrorStateOnly() {
  expect(screen.getByRole('alert')).toHaveTextContent(MINT_LIST_ERROR)
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  // fixed text only: nothing of the thrown error reaches the page
  expect(document.body.textContent).not.toContain('secret-internal-detail')
  expect(document.body.textContent).not.toMatch(/not a tracked mint|offline|0 online mints|0 tracked mints/i)
  expect(document.querySelectorAll('.mint-card')).toHaveLength(0)
}

describe('LoadError', () => {
  it('is an alert with the given sentence and a Try again button that calls onRetry once', () => {
    const onRetry = vi.fn()
    render(<LoadError message="Could not load X." onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load X.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
  it('the loading note is a status, not an alert', () => {
    render(<LoadingNote />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('the mint-list sentence is the agreed text', () => {
    expect(MINT_LIST_ERROR).toBe('Could not load the mint list. Please try again.')
  })
})

describe('Mint Detail', () => {
  const at = () => renderAt('/mint/' + encodeURIComponent('https://alpha.mint.example'), <MintDetail />, '/mint/:url')
  it('failed list: error state with retry, no "Not a tracked mint"', () => {
    at()
    expectErrorStateOnly()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(known.state.refetch).toHaveBeenCalledTimes(1)
  })
  it('list still loading: a quiet Loading… status, no error', () => {
    known.state.isError = false
    known.state.isLoading = true
    at()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('loaded list without this mint: still "Not a tracked mint" (a real answer)', () => {
    known.state.isError = false
    known.state.data = []
    at()
    expect(screen.getByText('Not a tracked mint')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Watchlist', () => {
  beforeEach(() => {
    useAuthStore.setState({ profile: { pubkey: '1'.repeat(64), npub: 'npub1x', name: 'T' } })
    useWatchlistStore.setState({
      mints: ['https://alpha.mint.example', 'https://bravo.mint.example'], syncStatus: 'done', isLoaded: true,
      loadFromDb: async () => undefined,
    })
  })
  it('failed list with watched mints: error state with retry, no card reading offline / n/a', () => {
    renderAt('/watchlist', <Watchlist />, '/watchlist')
    expectErrorStateOnly()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(known.state.refetch).toHaveBeenCalledTimes(1)
  })
  it('failed list but nothing watched: the honest empty state, no error', () => {
    useWatchlistStore.setState({ mints: [] })
    renderAt('/watchlist', <Watchlist />, '/watchlist')
    expect(screen.getByText('No mints watched yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('Home (Dashboard)', () => {
  it('failed list: error state with retry, and no derived "0 online mints · 0 tracked mints" strip', () => {
    renderAt('/', <Dashboard />, '/')
    expectErrorStateOnly()
    expect(document.querySelector('.dash-status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(known.state.refetch).toHaveBeenCalledTimes(1)
  })
  it('loaded list: the status strip is back', () => {
    known.state.isError = false
    known.state.data = []
    renderAt('/', <Dashboard />, '/')
    expect(document.querySelector('.dash-status')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
