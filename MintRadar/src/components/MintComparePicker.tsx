import { useState } from 'react'
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
          />
        </div>
        <div className="md-picker-list" tabIndex={0} role="group" aria-label="Mints to compare">
          {filtered.slice(0, 50).map(m => {
            const isChecked = selected.has(m.url)
            const disabled = !isChecked && selected.size >= maxSelect
            return (
              <div
                key={m.url}
                className={`md-picker-item${isChecked ? ' checked' : ''}${disabled ? ' disabled' : ''}`}
                onClick={() => {
                  if (disabled) return
                  setSelected(prev => {
                    const next = new Set(prev)
                    if (next.has(m.url)) next.delete(m.url); else next.add(m.url)
                    return next
                  })
                }}
              >
                <div className="md-picker-check" aria-hidden="true">{isChecked && '✓'}</div>
                <span className={`md-picker-dot${m.online === true ? '' : ' off'}`} />
                <div className="md-picker-text">
                  <div className="md-picker-name">{mintDisplayName(m, duplicateDisplayNames)}</div>
                  <div className="md-picker-host">{getHostname(m.url)}</div>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="md-picker-empty">No mints match your search.</div>
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
