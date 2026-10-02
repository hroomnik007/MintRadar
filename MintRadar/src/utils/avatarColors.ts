// Review-avatar fallback tiles and the text colour that keeps their initial readable (WCAG 4.5:1).
//
// The tile hues are a categorical identity palette (literal on purpose — they are not status colours,
// see the allowlist in __tests__/retiredColours.test.ts). The initial's colour is chosen PER TILE from
// theme tokens by the tile's relative luminance, so any palette entry reads: a fixed light or dark
// text would drop to 1.5–3.9:1 on some of the six.

export const REVIEW_AVATAR_COLORS = ['#17E87F', '#8b5cf6', '#F5A623', '#3b82f6', '#ef4444', '#ec4899'] as const

export function reviewAvatarColor(pubkey: string): string {
  return REVIEW_AVATAR_COLORS[parseInt(pubkey.slice(0, 8), 16) % REVIEW_AVATAR_COLORS.length] ?? '#17E87F'
}

// Dark text: --bg pulled halfway to black (plain --bg only reaches 4.39:1 on the violet tile).
export const AVATAR_TEXT_DARK = 'color-mix(in srgb, var(--bg) 50%, black)'
export const AVATAR_TEXT_LIGHT = 'var(--text)'

/** WCAG relative luminance of a `#rrggbb` colour. */
export function hexLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`avatarColors: expected #rrggbb, got ${hex}`)
  const n = parseInt(m[1]!, 16)
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}

// With dark text at L≈0.003 and light text at L≈0.92 the two contrasts cross at a tile luminance of ~0.17.
const DARK_TEXT_ABOVE_LUMINANCE = 0.17

/** Text colour (a CSS value built from theme tokens) for an initial on the given tile colour. */
export function avatarTextColor(tileHex: string): string {
  return hexLuminance(tileHex) > DARK_TEXT_ABOVE_LUMINANCE ? AVATAR_TEXT_DARK : AVATAR_TEXT_LIGHT
}
