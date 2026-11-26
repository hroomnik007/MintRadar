import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpDown, Check, ChevronDown } from 'lucide-react'

/**
 * The Mints page sort control in the site's own style (owner, 2026-11-20: the native list looked like a system window,
 * and only Chromium can restyle it). A button "Sort: Reliability" opens a list of the options; the chosen one carries a
 * check and a copper rule. Keyboard: Enter, Space or ArrowDown open it on the chosen option; ArrowUp / ArrowDown,
 * Home / End move; Enter or Space choose; Escape or Tab close; the focus returns to the button. A click outside closes it.
 */
export function SortMenu<T extends string>({ value, options, onChange, label = 'Sort by', className = '' }: {
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (v: T) => void
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = options.find(([v]) => v === value)?.[1] ?? ''

  const openAt = (i: number) => { setActive(i); setOpen(true) }
  const close = (focusButton = true) => { setOpen(false); if (focusButton) btnRef.current?.focus() }
  const choose = (i: number) => { const o = options[i]; if (o) onChange(o[0]); close() }

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onDown = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) close(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const selectedIndex = Math.max(0, options.findIndex(([v]) => v === value))

  return (
    <div className={`sort-menu ${className}`.trim()} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="sort-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current}`}
        onClick={() => (open ? close() : openAt(selectedIndex))}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openAt(selectedIndex) }
        }}
      >
        <span className="sort-select-text">
          {/* Phones (<= 600px) drop the word and show the arrows instead, so "Add a mint" fits beside it on one row. */}
          <ArrowUpDown size={14} aria-hidden="true" className="sort-select-icon" />
          <span className="sort-select-prefix">Sort: </span>{current}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="sort-select-chevron" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          className="sort-menu-list"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-o${active}`}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(options.length - 1, i + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)) }
            else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
            else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active) }
            else if (e.key === 'Escape') { e.preventDefault(); close() }
            else if (e.key === 'Tab') close(false)
          }}
        >
          {options.map(([v, text], i) => (
            <li
              key={v}
              id={`${id}-o${i}`}
              data-i={i}
              role="option"
              aria-selected={v === value}
              className={`sort-menu-option${i === active ? ' is-active' : ''}${v === value ? ' is-selected' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{text}</span>
              {v === value && <Check size={16} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
