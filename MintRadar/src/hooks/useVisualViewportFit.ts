import { useEffect } from 'react'

// While a dialog with a text field is open, publish the VISIBLE part of the page as two CSS variables on <html>:
// --vv-top and --vv-h (px). Phone browsers show the on-screen keyboard over the page without resizing the layout
// viewport (Chrome on Android and Safari since 2022), so a dialog centred in the layout viewport ends up half behind
// the keyboard. A dialog overlay that reads the variables (`top: var(--vv-top, 0); height: var(--vv-h, 100%)`)
// is centred, and sized, in what the visitor can actually see. Without a visualViewport (or when it is as large as
// the window) nothing is set and the CSS falls back to the whole viewport; the variables are removed on close.
export function useVisualViewportFit(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const apply = () => {
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`)
      root.style.setProperty('--vv-h', `${Math.round(vv.height)}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      root.style.removeProperty('--vv-top')
      root.style.removeProperty('--vv-h')
    }
  }, [active])
}
