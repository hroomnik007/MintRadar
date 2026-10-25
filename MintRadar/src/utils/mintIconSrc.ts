// Mint icon proxy URLs with the server-side size variants (Stage 2 perf, 2026-10-25). See MintFavicon.tsx.

/** Widths the backend icon proxy can resize to (`?s=`, backend/src/iconResize.ts); WebP when the browser accepts it. */
const ICON_VARIANTS = [64, 128] as const

/** Smallest server variant that covers `px` device pixels, or null for the original (> 128 px). */
export function iconVariantFor(px: number): number | null {
  return ICON_VARIANTS.find(v => px <= v) ?? null
}

/** The proxy URL for a mint icon at `variant` px (null = the original bytes). */
export function mintIconSrc(url: string, variant: number | null): string {
  const base = `/api/mint/icon?url=${encodeURIComponent(url)}`
  return variant === null ? base : `${base}&s=${variant}`
}

/** 1x / 2x / 3x candidates. The same URL may repeat: browsers pick the smallest density >= the screen's. */
export function mintIconSrcSet(url: string, size: number): string {
  return [1, 2, 3].map(d => `${mintIconSrc(url, iconVariantFor(size * d))} ${d}x`).join(', ')
}
