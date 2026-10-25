import { useState } from 'react'
import { mintFaviconInitials, mintHostname } from '@/utils/mintFormatting'
import { hasIconFailedRecently, markIconFailed } from '@/utils/mintIconFailureCache'
import { iconVariantFor, mintIconSrc, mintIconSrcSet } from '@/utils/mintIconSrc'

interface Props {
  url: string
  iconUrl?: string | null
  size?: number
  radius?: number
  className?: string
}

export function MintFavicon({ url, iconUrl, size = 22, radius = 5, className = '' }: Props) {
  const hostname = mintHostname(url)
  // Seeded from the failure cache so a mint whose icon recently failed (204 / error)
  // renders straight to the monogram on this mount — no repeat request. See
  // mintIconFailureCache.ts.
  const [imgFailed, setImgFailed] = useState(() => hasIconFailedRecently(url))

  // `iconUrl` is treated as a boolean hint ("this mint has an icon") ONLY — the
  // bytes are always fetched through the backend's SSRF-guarded proxy, never
  // straight from a mint-controlled host. A hostile icon_url in a mint's
  // /v1/info can't turn a page view into an IP / User-Agent tracking beacon
  // (2026-09-07 security audit). The proxy answers 204 No Content for anything
  // unsafe/unfetchable (no console noise, unlike a 404) and the img error event still fires,
  // so onError drops us to the SVG placeholder below.
  // The proxy resizes to 64 or 128 px (`&s=`), so a 22 px card icon no longer downloads a 512 px original; srcSet
  // picks the variant for the screen density. Without sharp on the server `&s=` is ignored (original bytes).
  const proxiedSrc = iconUrl ? mintIconSrc(url, iconVariantFor(size)) : null

  if (proxiedSrc && !imgFailed) {
    return (
      <img
        src={proxiedSrc}
        srcSet={mintIconSrcSet(url, size)}
        alt=""
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        className={className}
        style={{
          width: size, height: size, minWidth: size,
          borderRadius: radius, objectFit: 'contain',
          background: 'var(--bg3)', border: '0.5px solid var(--border)',
        }}
        onError={() => { markIconFailed(url); setImgFailed(true) }}
      />
    )
  }

  // No icon (or the proxied one failed): a two-letter monogram derived from the
  // hostname, so each mint gets a distinct placeholder rather than an identical
  // generic glyph.
  const initials = mintFaviconInitials(url)

  return (
    <div
      className={className}
      role="img"
      aria-label={`${hostname} mint icon placeholder`}
      style={{
        width: size, height: size, minWidth: size,
        borderRadius: radius, background: 'var(--copper-soft)',
        border: '0.5px solid var(--copper)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        // Copper lifted towards --text: plain --copper on the 15% copper tile was 3.6–4.3:1 on the
        // card / raised surfaces; this mix is >= 5.3:1 on every surface token and keeps the copper tint.
        color: 'color-mix(in srgb, var(--copper) 60%, var(--text))',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        lineHeight: 1,
        letterSpacing: '0.02em',
        userSelect: 'none',
      }}
    >
      {initials}
    </div>
  )
}
