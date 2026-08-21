import type { ComponentType } from 'react'

// Thematic glyphs for the Learn module cards, plus the decorative header
// illustration on /learn. All are stroke-only, geometric, and drawn with
// `currentColor` so the consuming element controls the colour via the
// existing design tokens — same approach as MintFavicon's coin placeholder.

// Module 1 — Cashu Basics. Deliberately mirrors public/mint-coin-placeholder.svg
// (concentric rings + shine arc) so the course opens on the same coin motif
// the user already sees on mintless cards.
function IcCoin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="5.6" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <path d="M7.4 15.2a6.6 6.6 0 0 0 9.2 0" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.3" />
    </svg>
  )
}

// Module 2 — Understanding the Risks. A shield with a quiet exclamation:
// caution, not alarm.
function IcShieldCaution() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 5.5 5.6v5.1c0 3.9 2.7 7.4 6.5 8.4 3.8-1 6.5-4.5 6.5-8.4V5.6L12 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 8.4v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.75" />
      <circle cx="12" cy="14.4" r="0.75" fill="currentColor" opacity="0.75" />
    </svg>
  )
}

// Module 3 — How to Choose a Mint. Compass needle, echoing the radar
// language of the MintRadar mark.
function IcCompass() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8 4.8-2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

// Module 4 — Getting Started with a Wallet.
function IcWallet() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="6" width="17" height="12.5" rx="2.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M20.5 10.6h-3.4a1.9 1.9 0 0 0 0 3.8h3.4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.8" />
    </svg>
  )
}

// Module 5 — Safe Habits.
function IcChecklist() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.8" y="4.2" width="14.4" height="15.6" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.2 10.2l1.5 1.5 3.2-3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.2 15.4h7.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
    </svg>
  )
}

// Keyed by the module ids in src/constants/learnModules.ts. Lives here rather
// than in that file because learnModules.ts is a plain .ts module with no JSX.
// Kept unexported so this file exports components only (react-refresh).
const MODULE_ICONS: Record<string, ComponentType> = {
  'cashu-basics': IcCoin,
  'understanding-the-risks': IcShieldCaution,
  'how-to-choose-a-mint': IcCompass,
  'getting-started-with-a-wallet': IcWallet,
  'safe-habits': IcChecklist,
}

// Renders the badge for one module card, or nothing for an id with no glyph
// — so a module added to learnModules.ts before its icon exists degrades to
// a card without a badge rather than an empty 32px box.
export function LearnModuleIcon({ moduleId }: { moduleId: string }) {
  const Icon = MODULE_ICONS[moduleId]
  if (!Icon) return null
  return (
    <span className="learn-card-icon">
      <Icon />
    </span>
  )
}

// Decorative band above the module grid — an abstract radar sweep with a few
// scattered blips, in the same concentric-ring language as NavLogo. Purely
// ornamental, so it is hidden from assistive tech.
export function LearnHero() {
  return (
    <svg
      className="learn-hero-svg"
      viewBox="0 0 720 120"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="learnHeroLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--green)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--green)" stopOpacity="0.42" />
          <stop offset="1" stopColor="var(--green)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="learnHeroWeb" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--green)" stopOpacity="0.05" />
          <stop offset="0.5" stopColor="var(--green)" stopOpacity="0.3" />
          <stop offset="1" stopColor="var(--green)" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* horizon line */}
      <line x1="0" y1="60" x2="720" y2="60" stroke="url(#learnHeroLine)" strokeWidth="1" />

      {/* radar rings */}
      <circle cx="360" cy="60" r="50" stroke="var(--green)" strokeWidth="1" opacity="0.16" />
      <circle cx="360" cy="60" r="34" stroke="var(--green)" strokeWidth="1" opacity="0.28" />
      <circle cx="360" cy="60" r="19" stroke="var(--green)" strokeWidth="1.2" opacity="0.45" />
      <circle cx="360" cy="60" r="3.2" fill="var(--green-bright)" opacity="0.75" />
      <line x1="360" y1="10" x2="360" y2="41" stroke="var(--green)" strokeWidth="1" opacity="0.25" />
      <line x1="360" y1="79" x2="360" y2="110" stroke="var(--green)" strokeWidth="1" opacity="0.25" />

      {/* node web spreading out from the sweep */}
      <path
        d="M182 84 L262 40 L360 60 L468 34 L556 76"
        stroke="url(#learnHeroWeb)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="182" cy="84" r="2.6" fill="var(--green)" opacity="0.35" />
      <circle cx="262" cy="40" r="3.2" fill="var(--green)" opacity="0.5" />
      <circle cx="468" cy="34" r="3.2" fill="var(--copper)" opacity="0.6" />
      <circle cx="556" cy="76" r="2.6" fill="var(--green)" opacity="0.35" />
      <circle cx="112" cy="48" r="1.8" fill="var(--green)" opacity="0.22" />
      <circle cx="624" cy="52" r="1.8" fill="var(--copper)" opacity="0.28" />
    </svg>
  )
}
