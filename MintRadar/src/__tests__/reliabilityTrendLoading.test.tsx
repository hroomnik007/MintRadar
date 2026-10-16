import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, renderHook, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ReliabilityTrendView, type TrendPoint } from '../components/stats/ReliabilityTrendChart'
import { useReliabilityTrend, type ReliabilityTrendResponse } from '../hooks/useReliabilityTrend'

const points: TrendPoint[] = [{ date: '2026-10-15', avgReliability: 80 }, { date: '2026-10-16', avgReliability: 82 }]

function view(overrides: Partial<React.ComponentProps<typeof ReliabilityTrendView>> = {}) {
  const onRetry = vi.fn()
  const utils = render(<ReliabilityTrendView data={points} isPending={false} isError={false} isPlaceholderData={false} onRetry={onRetry} {...overrides} />)
  return { onRetry, ...utils }
}

describe('ReliabilityTrendView', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('first load with nothing to show: the loading note, never "No data yet"', () => {
    view({ data: undefined, isPending: true })
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument()
  })

  it('another period pending: the previous chart stays, dimmed, and "No data yet" does not appear', () => {
    const { container } = view({ isPlaceholderData: true })
    const body = container.querySelector('.stats-trend-body')!
    expect(body).toHaveClass('is-pending')
    expect(body).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull()
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a settled chart is not dimmed', () => {
    const { container } = view()
    expect(container.querySelector('.stats-trend-body')).not.toHaveClass('is-pending')
  })

  it('a successful but empty response says "No data yet"', () => {
    view({ data: [] })
    expect(screen.getByText('No data yet')).toBeInTheDocument()
  })

  it('an error shows the load error with Try again, not "No data yet"', () => {
    const { onRetry } = view({ data: undefined, isError: true })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

const payload = (days: 30 | 90): ReliabilityTrendResponse => ({
  trend: [{ date: '2026-10-16', avgReliability: days === 30 ? 30 : 90 }],
  periodDays: days, earliestCheckedAt: null, daysOfDataAvailable: days,
})

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useReliabilityTrend', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('keeps the previous period as placeholder data while the other one is pending', async () => {
    let release: () => void = () => {}
    const fetchMock = vi.fn((url: string) => {
      const days = url.includes('days=90') ? 90 : 30
      if (days === 90) return new Promise<Response>(resolve => { release = () => resolve(Response.json(payload(90))) })
      return Promise.resolve(Response.json(payload(30)))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ days }: { days: 30 | 90 }) => useReliabilityTrend(days), { wrapper: wrapper(), initialProps: { days: 30 as 30 | 90 } })
    await waitFor(() => expect(result.current.data?.periodDays).toBe(30))
    // the prefetch of the other period is the held request here; switching to it waits on the same request
    rerender({ days: 90 })
    expect(result.current.isPlaceholderData).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(result.current.data?.periodDays).toBe(30)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/stats/reliability-trend?days=90'))
    await act(async () => { release() })
    await waitFor(() => expect(result.current.data?.periodDays).toBe(90))
    expect(result.current.isPlaceholderData).toBe(false)
  })

  it('prefetches the other period once after the first success, and switching back needs no new request', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(Response.json(payload(url.includes('days=90') ? 90 : 30))))
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ days }: { days: 30 | 90 }) => useReliabilityTrend(days), { wrapper: wrapper(), initialProps: { days: 30 as 30 | 90 } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/stats/reliability-trend?days=90'))
    rerender({ days: 90 })
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
    rerender({ days: 30 })
    expect(result.current.data?.periodDays).toBe(30)
    expect(result.current.isPlaceholderData).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not prefetch when the first request failed', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useReliabilityTrend(30), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    await new Promise<void>(done => setTimeout(done, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
