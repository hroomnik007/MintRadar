import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { tooltipManager } from '@/utils/tooltipManager'

// jsdom has no layout: every rectangle is 0 x 0, which still exercises the whole open / close / wiring path.
// Pointer events: PointerEvent carries pointerType; build it explicitly so the test does not depend on jsdom.
// React derives onPointerEnter / onPointerLeave from the bubbling pointerover / pointerout pair.
const REACT_EVENT: Record<string, string> = { pointerenter: 'pointerover', pointerleave: 'pointerout' }
function pointer(el: Element, type: string, pointerType: string) {
  const e = new MouseEvent(REACT_EVENT[type] ?? type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pointerType', { value: pointerType })
  act(() => { el.dispatchEvent(e) })
}
const trigger = (name: string | RegExp = /./) => screen.getAllByRole('button', { name }).find(b => b.hasAttribute('data-tooltip-trigger'))!
const tooltip = () => screen.queryByRole('tooltip')

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('InfoTooltip: trigger', () => {
  it('is a real button with the marker and an accessible name from label', () => {
    render(<InfoTooltip text="Hello" label="About the thing" />)
    const b = screen.getByRole('button', { name: 'About the thing' })
    expect(b.tagName).toBe('BUTTON')
    expect(b).toHaveAttribute('type', 'button')
    expect(b).toHaveAttribute('data-tooltip-trigger')
  })

  it('derives the name from the visible label (about) and has a non-empty default', () => {
    render(<><InfoTooltip text="a" about="Latency" /><InfoTooltip text="b" /></>)
    expect(screen.getByRole('button', { name: 'More information about Latency' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More information' })).toBeInTheDocument()
  })

  it('chip mode: the children are the visible text and name the button', () => {
    render(<InfoTooltip text="Not for real funds"><span>Test mint</span></InfoTooltip>)
    const b = screen.getByRole('button', { name: 'Test mint' })
    expect(b).toHaveAttribute('data-tooltip-trigger')
    expect(b).not.toHaveAttribute('aria-label')
    expect(b).not.toHaveAttribute('title')
  })

  it('has no tooltip element and no aria-describedby while closed', () => {
    render(<InfoTooltip text="Hello" label="x" />)
    expect(tooltip()).toBeNull()
    expect(trigger()).not.toHaveAttribute('aria-describedby')
  })
})

describe('InfoTooltip: mouse', () => {
  it('opens after the hover delay and closes on leave, with aria-describedby wired only while open', () => {
    render(<InfoTooltip text="Hello there" label="x" />)
    const b = trigger()
    pointer(b, 'pointerenter', 'mouse')
    expect(tooltip()).toBeNull() // not yet: ~100 ms delay
    act(() => { vi.advanceTimersByTime(100) })
    const tip = tooltip()!
    expect(tip).toHaveTextContent('Hello there')
    expect(tip.id).not.toBe('')
    expect(b).toHaveAttribute('aria-describedby', tip.id)
    pointer(b, 'pointerleave', 'mouse')
    expect(tooltip()).toBeNull()
    expect(b).not.toHaveAttribute('aria-describedby')
  })

  it('leaving before the delay never opens it', () => {
    render(<InfoTooltip text="Hello" label="x" />)
    pointer(trigger(), 'pointerenter', 'mouse')
    pointer(trigger(), 'pointerleave', 'mouse')
    act(() => { vi.advanceTimersByTime(300) })
    expect(tooltip()).toBeNull()
  })
})

describe('InfoTooltip: touch and keyboard', () => {
  it('ignores touch hover; the first tap opens, the second tap closes', () => {
    render(<InfoTooltip text="Hello" label="x" />)
    const b = trigger()
    pointer(b, 'pointerenter', 'touch')
    act(() => { vi.advanceTimersByTime(300) })
    expect(tooltip()).toBeNull()
    fireEvent.click(b)
    expect(tooltip()).not.toBeNull()
    pointer(b, 'pointerdown', 'touch') // a tap on the trigger itself is not "outside"
    expect(tooltip()).not.toBeNull()
    fireEvent.click(b)
    expect(tooltip()).toBeNull()
  })

  it('a tap anywhere outside closes it', () => {
    render(<><InfoTooltip text="Hello" label="x" /><p data-testid="other">other</p></>)
    fireEvent.click(trigger())
    expect(tooltip()).not.toBeNull()
    pointer(screen.getByTestId('other'), 'pointerdown', 'touch')
    expect(tooltip()).toBeNull()
  })

  it('keyboard focus (focus-visible) opens, blur closes, a click from Enter / Space toggles', () => {
    render(<InfoTooltip text="Hello" label="x" />)
    const b = trigger()
    const matches = vi.spyOn(b, 'matches').mockImplementation(sel => sel === ':focus-visible')
    act(() => { b.focus() })
    expect(tooltip()).not.toBeNull()
    fireEvent.click(b) // Enter or Space on a button is a click with detail 0
    expect(tooltip()).toBeNull()
    fireEvent.click(b)
    expect(tooltip()).not.toBeNull()
    act(() => { b.blur() })
    expect(tooltip()).toBeNull()
    matches.mockRestore()
  })

  it('pointer focus (not focus-visible) does not open on its own', () => {
    render(<InfoTooltip text="Hello" label="x" />)
    const b = trigger()
    vi.spyOn(b, 'matches').mockImplementation(() => false)
    act(() => { b.focus() })
    expect(tooltip()).toBeNull()
  })
})

describe('InfoTooltip: Escape, one at a time, hosts', () => {
  it('Escape closes only the tooltip and is stopped before anything behind it (a dialog) sees it', () => {
    const behind = vi.fn()
    document.addEventListener('keydown', behind)
    render(<InfoTooltip text="Hello" label="x" />)
    const b = trigger()
    fireEvent.click(b)
    expect(tooltip()).not.toBeNull()
    fireEvent.keyDown(b, { key: 'Escape' })
    expect(tooltip()).toBeNull()
    expect(behind).not.toHaveBeenCalled()
    // nothing open: Escape goes through to the container
    fireEvent.keyDown(b, { key: 'Escape' })
    expect(behind).toHaveBeenCalledTimes(1)
    document.removeEventListener('keydown', behind)
  })

  it('opening another tooltip closes the first', () => {
    render(<><InfoTooltip text="First" label="one" /><InfoTooltip text="Second" label="two" /></>)
    fireEvent.click(screen.getByRole('button', { name: 'one' }))
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'two' }))
    const tips = screen.getAllByRole('tooltip')
    expect(tips).toHaveLength(1)
    expect(tips[0]).toHaveTextContent('Second')
  })

  it('a click never reaches the host (card, link, label, dialog backdrop)', () => {
    const host = vi.fn()
    render(<div onClick={host}><InfoTooltip text="Hello" label="x" /></div>)
    fireEvent.click(trigger())
    expect(host).not.toHaveBeenCalled()
  })

  it('does not toggle a label\'s checkbox', () => {
    const change = vi.fn()
    render(<label><input type="checkbox" onChange={change} /> Hide <InfoTooltip text="Hello" label="x" /></label>)
    fireEvent.click(trigger())
    expect(change).not.toHaveBeenCalled()
  })
})

describe('InfoTooltip: portal target', () => {
  it('renders in document.body outside a dialog and inside the enclosing dialog within one', () => {
    const { unmount } = render(<InfoTooltip text="Out" label="x" />)
    fireEvent.click(trigger())
    expect(tooltip()!.parentElement).toBe(document.body)
    unmount()

    render(<div role="dialog" aria-label="d" data-testid="dlg"><InfoTooltip text="In" label="y" /></div>)
    fireEvent.click(trigger())
    expect(tooltip()!.parentElement).toBe(screen.getByTestId('dlg'))
  })
})

describe('InfoTooltip: listeners and cleanup', () => {
  it('registers no document or window listener while closed, one set while open, none after closing', () => {
    const docAdd = vi.spyOn(document, 'addEventListener')
    const winAdd = vi.spyOn(window, 'addEventListener')
    render(<InfoTooltip text="Hello" label="x" />)
    const WATCHED = ['keydown', 'pointerdown', 'scroll', 'resize', 'orientationchange']
    const relevant = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(c => WATCHED.includes(String(c[0])))
    expect(relevant(docAdd)).toHaveLength(0)
    expect(relevant(winAdd)).toHaveLength(0)
    expect(tooltipManager.listening()).toBe(false)

    fireEvent.click(trigger())
    expect(tooltipManager.listening()).toBe(true)
    expect(relevant(docAdd).map(c => c[0]).sort()).toEqual(['pointerdown', 'scroll'])
    expect(relevant(winAdd).map(c => c[0]).sort()).toEqual(['keydown', 'orientationchange', 'resize'])

    const docRemove = vi.spyOn(document, 'removeEventListener')
    const winRemove = vi.spyOn(window, 'removeEventListener')
    fireEvent.click(trigger())
    expect(tooltipManager.listening()).toBe(false)
    expect(relevant(docRemove).map(c => c[0]).sort()).toEqual(['pointerdown', 'scroll'])
    expect(relevant(winRemove).map(c => c[0]).sort()).toEqual(['keydown', 'orientationchange', 'resize'])
  })

  it('unmounting an open tooltip removes it and the listeners, and clears a pending hover timer', () => {
    const { unmount } = render(<InfoTooltip text="Hello" label="x" />)
    fireEvent.click(trigger())
    expect(tooltipManager.listening()).toBe(true)
    unmount()
    expect(tooltip()).toBeNull()
    expect(tooltipManager.listening()).toBe(false)
    expect(tooltipManager.activeId()).toBeNull()

    render(<InfoTooltip text="Hello" label="x" />)
    pointer(trigger(), 'pointerenter', 'mouse')
    cleanup()
    act(() => { vi.advanceTimersByTime(500) })
    expect(tooltip()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('InfoTooltip: placement', () => {
  it('shows the box only after it is placed, and re-places it on resize and scroll', () => {
    render(<InfoTooltip text="Hello" label="x" />)
    const b = trigger()
    const rect = vi.spyOn(b, 'getBoundingClientRect')
    rect.mockReturnValue({ left: 100, top: 300, right: 124, bottom: 324, width: 24, height: 24, x: 100, y: 300, toJSON: () => ({}) })
    fireEvent.click(b)
    const tip = tooltip()!
    expect(tip.style.visibility).toBe('visible')
    expect(tip.style.left).not.toBe('')
    expect(tip.style.top).not.toBe('')
    const before = tip.style.left
    rect.mockReturnValue({ left: 200, top: 300, right: 224, bottom: 324, width: 24, height: 24, x: 200, y: 300, toJSON: () => ({}) })
    act(() => { window.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(50) })
    expect(tip.style.left).not.toBe(before)
    const afterResize = tip.style.left
    rect.mockReturnValue({ left: 50, top: 300, right: 74, bottom: 324, width: 24, height: 24, x: 50, y: 300, toJSON: () => ({}) })
    act(() => { document.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(50) })
    expect(tip.style.left).not.toBe(afterResize)
  })

  it('closes when the trigger has scrolled out of the viewport', () => {
    render(<InfoTooltip text="Hello" label="x" />)
    const b = trigger()
    const rect = vi.spyOn(b, 'getBoundingClientRect')
    rect.mockReturnValue({ left: 100, top: 300, right: 124, bottom: 324, width: 24, height: 24, x: 100, y: 300, toJSON: () => ({}) })
    fireEvent.click(b)
    expect(tooltip()).not.toBeNull()
    rect.mockReturnValue({ left: 100, top: -500, right: 124, bottom: -476, width: 24, height: 24, x: 100, y: -500, toJSON: () => ({}) })
    act(() => { document.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(50) })
    expect(tooltip()).toBeNull()
  })
})
