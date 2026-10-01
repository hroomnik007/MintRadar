import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronDown, ChevronUp, User } from 'lucide-react'
import type { NostrProfile } from '@/core/nostr/client'

type LoginMethod = 'nip07' | 'nsec' | 'remote-signer'

// Short label for the login-method badge.
const METHOD_BADGE: Record<LoginMethod, string> = {
  nip07: 'Extension',
  nsec: 'nsec',
  'remote-signer': 'Remote signer',
}

// npub1abc…xyz789 — same head/tail truncation idiom used for keys elsewhere.
function shortNpub(npub: string): string {
  if (npub.length <= 20) return npub
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`
}

// Logout glyph (same one the old Disconnect button used).
const IcLogout = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M5.5 1.5H2.5v11h3M8.5 4l3.5 3-3.5 3M12 7H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

// First character by grapheme (not by UTF-16 unit / byte), uppercased. null → no usable name
// (empty, or an npub), the placeholder then shows a User icon instead of a letter.
const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
function avatarInitial(name: string | null | undefined): string | null {
  const t = name?.trim() ?? ''
  if (t === '' || /^npub1[0-9a-z]{20,}$/i.test(t)) return null
  const first = graphemes ? graphemes.segment(t)[Symbol.iterator]().next().value?.segment : Array.from(t)[0]
  return first ? first.toLocaleUpperCase() : null
}

type CopyState = 'idle' | 'copied' | 'failed'
const COPY_FEEDBACK_MS = 1500

interface Props {
  profile: NostrProfile
  method: LoginMethod | null
  onLogout: () => void
}

// Navbar account chip (avatar + name + chevron) that discloses a small panel:
// name + login-method badge, copy-npub row, Log out. Disclosure pattern (button with
// aria-expanded / aria-controls) — deliberately not role="menu".
export function AccountMenu({ profile, method, onLogout }: Props) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const wrapRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  // URL that failed to load; a different URL (derived comparison) shows the image again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])

  // Single close path: resets the copy feedback and its timer.
  const close = useCallback((returnFocus = false) => {
    setOpen(false)
    setCopyState('idle')
    clearTimer()
    if (returnFocus) chipRef.current?.focus()
  }, [clearTimer])
  useEffect(() => clearTimer, [clearTimer]) // unmount

  // Route change closes the panel (derived during render — no effect-driven setState).
  const [seenPath, setSeenPath] = useState(pathname)
  if (seenPath !== pathname) {
    setSeenPath(pathname)
    setOpen(false)
    setCopyState('idle')
  }

  // Escape (focus back to the chip) and outside pointerdown — only while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, close])

  // Focus moving to another element outside the widget (Tab) closes it. relatedTarget === null
  // (pointer on non-focusable area, window blur) is handled by the pointerdown path instead.
  function onBlur(e: React.FocusEvent) {
    const next = e.relatedTarget as Node | null
    if (next !== null && !wrapRef.current?.contains(next)) close()
  }

  async function copyNpub() {
    clearTimer()
    try {
      await navigator.clipboard.writeText(profile.npub)
      setCopyState('copied')
    } catch {
      setCopyState('failed') // denied / unavailable clipboard
    }
    timerRef.current = setTimeout(() => { timerRef.current = null; setCopyState('idle') }, COPY_FEEDBACK_MS)
  }

  const displayName = profile.name?.trim() ? profile.name : `${profile.pubkey.slice(0, 8)}...`
  const copyLabel = copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : shortNpub(profile.npub)
  const showImg = !!profile.picture?.startsWith('https://') && failedSrc !== profile.picture
  const initial = avatarInitial(profile.name)
  const Chevron = open ? ChevronUp : ChevronDown

  return (
    <div className="navbar-account" ref={wrapRef} onBlur={onBlur}>
      <button
        type="button"
        ref={chipRef}
        className="navbar-profile"
        title={profile.name ?? undefined}
        aria-label={`Account: ${displayName}`}
        aria-expanded={open}
        aria-controls="navbar-account-panel"
        onClick={() => { if (open) close(); else setOpen(true) }}
      >
        {/* Fixed 22px round slot: image (https:// only — same guard as the other two
            profile.picture call sites, 2026-09-07 audit hardening) or, when there is no usable
            picture / it failed to load, a tinted placeholder of the same size. */}
        {showImg ? (
          <img src={profile.picture} alt=""
            className="navbar-avatar"
            onError={() => setFailedSrc(profile.picture ?? null)}
          />
        ) : (
          <span className="navbar-avatar navbar-avatar--placeholder" aria-hidden="true">
            {initial ?? <User size={13} strokeWidth={2.4} />}
          </span>
        )}
        <span className="navbar-username" title={profile.name ?? undefined}>{displayName}</span>
        <Chevron className="navbar-chevron" size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      <div id="navbar-account-panel" className="navbar-account-panel" hidden={!open}>
        <div className="navbar-account-who">
          <span className="navbar-account-name">{displayName}</span>
          {method !== null && (
            <span
              className={`navbar-method-badge${method === 'nsec' ? ' navbar-method-badge--nsec' : ''}`}
              title={method === 'nsec' ? 'Your key is held in this browser for this session' : undefined}
            >
              {METHOD_BADGE[method]}
            </span>
          )}
        </div>
        <button type="button" className="navbar-npub" title="Copy full npub" onClick={() => { void copyNpub() }}>
          {copyLabel}
        </button>
        <span className="navbar-account-sr" aria-live="polite">
          {copyState === 'copied' ? 'npub copied' : copyState === 'failed' ? 'Copy failed' : ''}
        </span>
        <button type="button" className="navbar-logout-btn" onClick={() => { close(); onLogout() }}>
          <IcLogout />
          <span>Log out</span>
        </button>
      </div>
    </div>
  )
}
