import type { KeyboardEvent } from 'react'

// Props that make a non-button element (a row or card that opens a dialog or a page) operable
// from the keyboard and announced as a button: focusable, Enter / Space activate it. Only a key
// pressed on the element itself counts, so a link or button nested inside keeps its own keys.
export function clickableProps(onClick: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    ...(label ? { 'aria-label': label } : {}),
    onClick,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick()
      }
    },
  }
}
