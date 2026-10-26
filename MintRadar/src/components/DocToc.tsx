import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type MutableRefObject } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { activeSectionId, tocScrollBehavior } from '@/utils/docToc'
import './DocToc.css'

// "On this page" of a long doc page (/for-wallets, /methodology). Same look as the About list (.about-toc), plus:
// - the current section is marked (aria-current="location"),
// - a click scrolls smoothly (instantly with prefers-reduced-motion) and moves focus to the section heading,
// - on phones (≤640px) the sticky list folds into one "On this page" button, so it no longer covers a quarter
//   of the screen while staying one tap away anywhere on the page.
// Section ids are the stable ids of the page's h2 headings; the links stay real links (#id), so they can be
// copied, opened in a new tab and work without this script.

export interface DocTocSection { id: string; label: string }

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches
}

// Where a heading counts as reached: below the sticky navbar and, where the list is a bar across the page
// (≤900px), below that bar too; plus a margin so a heading the TOC just scrolled to (scroll-margin-top) counts.
function scrollOffset(toc: HTMLElement | null): number {
  const nav = document.querySelector<HTMLElement>('.navbar')
  let edge = nav ? nav.getBoundingClientRect().bottom : 0
  if (toc) {
    const r = toc.getBoundingClientRect()
    if (r.width > window.innerWidth / 2) edge = Math.max(edge, r.bottom)
  }
  return edge + 32
}

export function DocToc({ sections, handledRef }: { sections: readonly DocTocSection[]; handledRef: MutableRefObject<boolean> }) {
  const { hash } = useLocation()
  const navigate = useNavigate()
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null)

  // Current section from the headings' positions, recomputed at most once per frame while scrolling.
  useEffect(() => {
    let raf = 0
    const update = (): void => {
      raf = 0
      const tops = sections.flatMap(s => {
        const el = document.getElementById(s.id)
        return el ? [{ id: s.id, top: el.getBoundingClientRect().top }] : []
      })
      setActive(activeSectionId(tops, scrollOffset(navRef.current)))
    }
    const onScroll = (): void => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [sections])

  // Escape closes the folded list on phones and gives focus back to its button.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setOpen(false); toggleRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onLinkClick = useCallback((e: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Let the browser handle new-tab / new-window clicks.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const el = document.getElementById(id)
    if (!el) return
    e.preventDefault()
    // Collapse the mobile list synchronously so the scroll target is measured
    // after the layout shift, not before it.
    flushSync(() => setOpen(false))
    setActive(id)
    el.scrollIntoView({ behavior: tocScrollBehavior(prefersReducedMotion()), block: 'start' })
    el.focus({ preventScroll: true })
    if (hash !== `#${id}`) {
      handledRef.current = true
      void navigate({ hash: `#${id}` })
    }
  }, [hash, navigate, handledRef])

  const activeLabel = sections.find(s => s.id === active)?.label ?? sections[0]?.label ?? ''

  return (
    <nav ref={navRef} className={`about-toc doc-toc${open ? ' is-open' : ''}`} aria-label="On this page">
      <p className="about-toc-title">On this page</p>
      <button
        ref={toggleRef}
        type="button"
        className="doc-toc-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(o => !o)}
      >
        <span className="doc-toc-toggle-title">On this page</span>
        <span className="doc-toc-toggle-current">{activeLabel}</span>
        <svg className="doc-toc-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ul id={listId} className="doc-toc-list">
        {sections.map(s => (
          <li key={s.id}>
            <Link
              to={{ hash: `#${s.id}` }}
              className={`about-toc-link${active === s.id ? ' is-active' : ''}`}
              aria-current={active === s.id ? 'location' : undefined}
              onClick={e => onLinkClick(e, s.id)}
            >{s.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
