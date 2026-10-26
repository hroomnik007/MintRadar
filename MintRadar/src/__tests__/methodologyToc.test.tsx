// The /methodology "On this page" navigation (the same DocToc as /for-wallets) (components/DocToc.tsx): one link per section to a stable h2 id,
// a disclosure button for phones, aria-current on the section in view, and an in-page jump that focuses the heading.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import Methodology from '@/pages/Methodology'

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
const renderPage = () => render(<MemoryRouter initialEntries={['/methodology']}><Methodology /><HashProbe /></MemoryRouter>)
const nav = () => screen.getByRole('navigation', { name: 'On this page' })

describe('Methodology table of contents', () => {
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
    // The stable ids the rest of the site and old links point at.
    expect(ids).toEqual(['what-it-is', 'components', 'caps-and-gates', 'reviews', 'sources', 'not-measured', 'change-log', 'where-published', 'report-an-error'])
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
    const link = within(nav()).getByRole('link', { name: 'Change log' })
    fireEvent.click(link)
    expect(scrolls).toEqual([{ id: 'change-log', behavior: 'smooth' }])
    expect(document.activeElement?.id).toBe('change-log')
    expect(currentHash).toBe('#change-log')
    expect(link.getAttribute('aria-current')).toBe('location')
    expect(within(nav()).getAllByRole('link').filter(a => a.hasAttribute('aria-current'))).toHaveLength(1)
    expect(within(nav()).getByRole('button').textContent).toContain('Change log')
  })

  it('reduced motion: the jump is instant', () => {
    reduced = true
    renderPage()
    fireEvent.click(within(nav()).getByRole('link', { name: 'Data sources' }))
    expect(scrolls.at(-1)).toEqual({ id: 'sources', behavior: 'auto' })
  })

  it('new-tab clicks are left to the browser', () => {
    renderPage()
    const link = within(nav()).getByRole('link', { name: 'Reviews' })
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    link.dispatchEvent(ev)
    expect(scrolls).toHaveLength(0)
  })

  it('the first section is marked before any scroll, and the intro "change log" link still points at #change-log', () => {
    const { container } = renderPage()
    const marked = within(nav()).getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'location')
    expect(marked).toHaveLength(1)
    expect(within(nav()).getByRole('button').textContent).toMatch(/On this page/)
    const intro = Array.from(container.querySelectorAll('.about-text a[href="#change-log"]'))
    expect(intro.length).toBeGreaterThanOrEqual(1)
    expect(container.querySelector('h2#change-log')).not.toBeNull()
  })
})
