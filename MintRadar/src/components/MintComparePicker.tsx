import { useRef, useState, type KeyboardEvent } from 'react'
import { IcClose } from '@/components/IcClose'
import { type KnownMint } from '@/hooks/useKnownMints'
import { useModalFocus } from '@/hooks/useModalFocus'
import { displayName as mintDisplayName, mintHostname as getHostname } from '@/utils/mintFormatting'
import './MintComparePicker.css'

// Shared "Compare with..." mint picker — opened from both Dashboard (per-card
// ⇄ Compare button) and MintDetail (header Compare button) ahead of
// ComparisonModal. `candidates` is the caller-filtered pool to pick from
// (base mint already excluded); selection/search state lives here so callers
// only need to hand back the final URLs via onConfirm.
//
// Keyboard (2026-10-27): the list is a multi-select listbox of real <button role="option"> items with a roving
// tabindex — one Tab stop for the whole list, ArrowUp/ArrowDown/Home/End move, Enter/Space toggle (native button
// click), ArrowDown in the search field jumps into the list. Every candidate is listed (no 50-item cap), so a mint
// can be found by scrolling without searching first.
export function MintComparePicker({
  candidates,
  baseLabel,
  maxSelect = 3,
  onClose,
  onConfirm,
  duplicateDisplayNames,
}: {
  candidates: KnownMint[]
  baseLabel: string
  maxSelect?: number
  onClose: () => void
  onConfirm: (selectedUrls: string[]) => void
  // From computeDuplicateMintNames() over the full known-mints list (not just
  // `candidates`, which is already filtered to online mints) — see MintCard's
  // own duplicateDisplayNames prop for why this matters.
  duplicateDisplayNames?: ReadonlySet<string> | undefined
}) {
  const dialogRef = useModalFocus('.md-picker-search') // search field first, as before (was autoFocus)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const q = search.toLowerCase()
  const filtered = candidates.filter(m =>
    q === '' || mintDisplayName(m, duplicateDisplayNames).toLowerCase().includes(q) || m.url.toLowerCase().includes(q)
  )
  // Roving tabindex: the one option in the Tab order. Clamped so a narrower search never points past the end.
  const [active, setActive] = useState(0)
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0))
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const focusOption = (i: number) => {
    if (filtered.length === 0) return
    const next = Math.max(0, Math.min(i, filtered.length - 1))
    setActive(next)
    optionRefs.current[next]?.focus()
  }

  const toggle = (url: string, disabled: boolean) => {
    if (disabled) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url); else next.add(url)
      return next
    })
  }

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: activeIndex + 1, ArrowUp: activeIndex - 1, Home: 0, End: filtered.length - 1 }
    if (!(e.key in keys)) return
    e.preventDefault()
    focusOption(keys[e.key]!)
  }

  return (
    <div className="cmp-overlay" onClick={onClose}>
      <div className="md-picker-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="md-picker-title" ref={dialogRef}>
        <div className="md-picker-header">
          <div id="md-picker-title" className="md-picker-title">Compare with...</div>
          <button type="button" className="md-picker-close" onClick={onClose} aria-label="Close"><IcClose /></button>
        </div>
        <div className="md-picker-top">
          <div className="md-picker-hint">
            Select 1–{maxSelect} mints to compare with <strong>{baseLabel}</strong>
          </div>
          <input
            className="md-picker-search"
            type="text"
            placeholder="Search mints…" aria-label="Search mints"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'ArrowDown' && filtered.length > 0) { e.preventDefault(); focusOption(activeIndex) } }}
          />
        </div>
        <div className="md-picker-list">
          {filtered.length > 0 ? (
            <div className="md-picker-options" role="listbox" aria-multiselectable="true" aria-label="Mints to compare" onKeyDown={onListKeyDown}>
              {filtered.map((m, i) => {
                const isChecked = selected.has(m.url)
                const disabled = !isChecked && selected.size >= maxSelect
                return (
                  <button
                    type="button"
                    role="option"
                    key={m.url}
                    ref={el => { optionRefs.current[i] = el }}
                    tabIndex={i === activeIndex ? 0 : -1}
                    aria-selected={isChecked}
                    aria-disabled={disabled || undefined}
                    className={`md-picker-item${isChecked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                    onFocus={() => setActive(i)}
                    onClick={() => toggle(m.url, disabled)}
                  >
                    <span className="md-picker-check" aria-hidden="true">{isChecked && '✓'}</span>
                    <span className={`md-picker-dot${m.online === true ? '' : ' off'}`} aria-hidden="true" />
                    <span className="md-picker-text">
                      <span className="md-picker-name">{mintDisplayName(m, duplicateDisplayNames)}</span>
                      <span className="md-picker-host">{getHostname(m.url)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="md-picker-empty" role="status">No mints match your search.</div>
          )}
        </div>
        <div className="md-picker-footer">
          <span className="md-picker-count">{selected.size} of {maxSelect} selected</span>
          <button
            className="md-picker-confirm"
            disabled={selected.size === 0}
            onClick={() => onConfirm([...selected])}
          >
            Compare ({selected.size})
          </button>
        </div>
      </div>
    </div>
  )
}
