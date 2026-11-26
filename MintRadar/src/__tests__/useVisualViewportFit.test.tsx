import { describe, it, expect, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { useVisualViewportFit } from '@/hooks/useVisualViewportFit'

// The Add a mint dialog follows the visible part of the page while the on-screen keyboard is up: the hook publishes
// --vv-top / --vv-h on <html> and removes them again when the dialog closes.

function Probe({ active }: { active: boolean }) { useVisualViewportFit(active); return null }

class FakeViewport extends EventTarget { offsetTop = 0; height = 800 }
const root = document.documentElement
const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
afterEach(() => {
  if (original) Object.defineProperty(window, 'visualViewport', original); else Reflect.deleteProperty(window, 'visualViewport')
  root.style.removeProperty('--vv-top'); root.style.removeProperty('--vv-h')
})
const install = (vv: FakeViewport | null) => Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })

describe('useVisualViewportFit', () => {
  it('sets the variables from the visual viewport, follows resize and scroll, and removes them on close', () => {
    const vv = new FakeViewport(); install(vv)
    const { rerender } = render(<Probe active />)
    expect(root.style.getPropertyValue('--vv-h')).toBe('800px')
    vv.height = 412.4; vv.dispatchEvent(new Event('resize'))
    expect(root.style.getPropertyValue('--vv-h')).toBe('412px')
    vv.offsetTop = 30; vv.dispatchEvent(new Event('scroll'))
    expect(root.style.getPropertyValue('--vv-top')).toBe('30px')
    rerender(<Probe active={false} />)
    expect(root.style.getPropertyValue('--vv-h')).toBe('')
    expect(root.style.getPropertyValue('--vv-top')).toBe('')
  })
  it('does nothing while the dialog is closed or when there is no visual viewport', () => {
    const vv = new FakeViewport(); install(vv)
    render(<Probe active={false} />)
    expect(root.style.getPropertyValue('--vv-h')).toBe('')
    install(null)
    render(<Probe active />)
    expect(root.style.getPropertyValue('--vv-h')).toBe('')
  })
  it('stops listening after the dialog closes', () => {
    const vv = new FakeViewport(); install(vv)
    const { unmount } = render(<Probe active />)
    unmount()
    vv.height = 300; vv.dispatchEvent(new Event('resize'))
    expect(root.style.getPropertyValue('--vv-h')).toBe('')
  })
})
