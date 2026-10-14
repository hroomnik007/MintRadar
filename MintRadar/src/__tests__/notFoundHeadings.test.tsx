// Every not-found / transitional route state has exactly one h1 (axe page-has-heading-one, and the heading
// is what a screen reader announces first). The visible layout is unchanged: the visible title became the h1
// where there is one, otherwise the h1 is visually hidden.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const known = vi.hoisted(() => ({
  state: { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() },
}))
vi.mock('@/hooks/useKnownMints', () => ({ useKnownMints: () => known.state }))
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  // MintNaddr redirects right after mount; keep the state it shows while it resolves
  useNavigate: () => vi.fn(),
}))

import MintDetail from '@/pages/MintDetail'
import LearnModule from '@/pages/LearnModule'
import NotFound from '@/pages/NotFound'
import MintNaddr from '@/pages/MintNaddr'

function h1s(path: string, route: string, ui: React.ReactElement) {
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={ui} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  )
  return Array.from(container.querySelectorAll('h1')).map(h => h.textContent)
}

describe('exactly one h1 on every not-found style state', () => {
  it('unknown Learn module', () => {
    expect(h1s('/learn/99', '/learn/:moduleId', <LearnModule />)).toEqual(['Module not found'])
    expect(h1s('/learn/not-a-module', '/learn/:moduleId', <LearnModule />)).toEqual(['Module not found'])
  })
  it('"Not a tracked mint"', () => {
    known.state = { data: [], isLoading: false, isError: false, refetch: vi.fn() }
    expect(h1s('/mint/' + encodeURIComponent('https://nope.example'), '/mint/:url', <MintDetail />)).toEqual(['Not a tracked mint'])
  })
  it('invalid mint URL', () => {
    known.state = { data: [], isLoading: false, isError: false, refetch: vi.fn() }
    expect(h1s('/mint/%25E0', '/mint/:url', <MintDetail />)).toEqual(['Invalid mint URL.'])
  })
  it('Mint Detail while the list loads and after it failed', () => {
    known.state = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    expect(h1s('/mint/' + encodeURIComponent('https://a.example'), '/mint/:url', <MintDetail />)).toEqual(['Mint details'])
    known.state = { data: undefined, isLoading: false, isError: true, refetch: vi.fn() }
    expect(h1s('/mint/' + encodeURIComponent('https://a.example'), '/mint/:url', <MintDetail />)).toEqual(['Mint details'])
  })
  it('404 page', () => {
    expect(h1s('/nope', '*', <NotFound />)).toEqual(['Page not found'])
  })
  it('naddr link while it resolves', () => {
    expect(h1s('/mint/nostr/x', '/mint/nostr/:naddr', <MintNaddr />)).toEqual(['Resolving mint…'])
  })
})
