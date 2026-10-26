// The /for-wallets "On this page" navigation (components/DocToc.tsx): one link per section to a stable h2 id,
// a disclosure button for phones, aria-current on the section in view, and an in-page jump that focuses the heading.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import ForWallets from '@/pages/ForWallets'

let reduced = false
const scrolls: Array<{ id: string; behavior: ScrollBehavior | undefined }> = []

beforeEach(() => {
  reduced = false
  scrolls.length = 0
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  }))
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
    scrolls.push({ id: this.id, behavior: typeof arg === 'object' ? arg.behavior : undefined })
  }
})
afterEach(() => { vi.unstubAllGlobals() })

let currentHash = ''
function HashProbe() {
  const { hash } = useLocation()
  useEffect(() => { currentHash = hash }, [hash])
  return null
}
const renderPage = () => render(<MemoryRouter initialEntries={['/for-wallets']}><ForWallets /><HashProbe /></MemoryRouter>)
const nav = () => screen.getByRole('navigation', { name: 'On this page' })

describe('For wallets table of contents', () => {
  it('every link points at an h2 with a stable id, in the order of the page', () => {
    const { container } = renderPage()
    const ids = Array.from(within(nav()).getAllByRole('link')).map(a => a.getAttribute('href')!.split('#')[1])
    expect(ids.length).toBeGreaterThanOrEqual(8)
    const h2 = Array.from(container.querySelectorAll('h2[id]')).map(h => h.id)
    expect(ids).toEqual(h2.filter(id => ids.includes(id)))
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/)
      expect(container.querySelector(`h2#${id}`)!.getAttribute('tabindex')).toBe('-1')
    }
    expect(ids).toEqual(expect.arrayContaining(['quick-start', 'polling', 'errors', 'stability', 'signed-health-assertions', 'ux', 'links']))
  })

  it('the phone toggle is a disclosure button that controls the list; Escape closes it and keeps focus', () => {
    renderPage()
    const toggle = within(nav()).getByRole('button', { name: /On this page/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(list?.tagName).toBe('UL')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(nav().className).toContain('is-open')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
  })

  it('a click scrolls smoothly to the heading, focuses it, sets the hash and marks the link', () => {
    renderPage()
    const link = within(nav()).getByRole('link', { name: 'Errors' })
    fireEvent.click(link)
    expect(scrolls).toEqual([{ id: 'errors', behavior: 'smooth' }])
    expect(document.activeElement?.id).toBe('errors')
    expect(currentHash).toBe('#errors')
    expect(link.getAttribute('aria-current')).toBe('location')
    expect(within(nav()).getAllByRole('link').filter(a => a.hasAttribute('aria-current'))).toHaveLength(1)
    expect(within(nav()).getByRole('button').textContent).toContain('Errors')
  })

  it('reduced motion: the jump is instant', () => {
    reduced = true
    renderPage()
    fireEvent.click(within(nav()).getByRole('link', { name: 'Stability' }))
    expect(scrolls.at(-1)).toEqual({ id: 'stability', behavior: 'auto' })
  })

  it('new-tab clicks are left to the browser', () => {
    renderPage()
    const link = within(nav()).getByRole('link', { name: 'Filters' })
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(ev)
    expect(scrolls).toHaveLength(0)
  })
})
