import type { ComponentType } from 'react'
import type { WalletPlatform } from '@/constants/wallets'

// Platform glyphs for the wallet cards. Stroke-only, geometric, drawn with
// `currentColor` so the badge element controls the colour via the design tokens
// — same approach as src/components/learn/LearnIcons.tsx. Path data mirrors the
// Tabler icons named in the design brief (ti-brand-android / ti-brand-apple /
// ti-world / ti-terminal-2); redrawn inline because the project ships no icon
// font and pulls nothing from a CDN.

function IcAndroid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 10v6M20 10v6M7 9h10v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
      <path d="M8 3l1 2M16 3l-1 2M9 18v3M15 18v3M7 9a5 5 0 0 1 10 0" />
    </svg>
  )
}

function IcApple() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.286 7.008c-3.216 0-4.286 3.23-4.286 5.92 0 3.229 2.143 8.072 4.286 8.072 1.165-.05 1.799-.538 3.214-.538 1.406 0 1.799.538 3.214.538 2.143 0 4.286-4.843 4.286-8.072 0-2.69-1.07-5.92-4.286-5.92-1.606 0-2.34.5-3.214.5-.875 0-1.608-.5-3.214-.5z" />
      <path d="M12 4a2 2 0 0 0 2-2 2 2 0 0 0-2 2" />
    </svg>
  )
}

function IcWorld() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18" />
    </svg>
  )
}

function IcTerminal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 9l3 3-3 3M13 15h3" />
    </svg>
  )
}

const PLATFORM_ICONS: Record<WalletPlatform, ComponentType> = {
  Android: IcAndroid,
  iOS: IcApple,
  Web: IcWorld,
  CLI: IcTerminal,
}

/**
 * Badge for a wallet card, keyed off its primary (first-listed) platform.
 * Falls back to the Web glyph for an unknown platform value so a new entry
 * never renders an empty box.
 */
export function WalletPlatformIcon({ platform }: { platform: WalletPlatform | undefined }) {
  const Icon = (platform && PLATFORM_ICONS[platform]) ?? IcWorld
  return (
    <span className="wallet-icon">
      <Icon />
    </span>
  )
}
