// The MintRadar mark: a radar screen. A dark disc, a beam that sweeps clockwise and leaves a fading trail, and a
// copper blip (a mint the beam has just found). ONE drawing for the navbar, the page headers (PageHead) and
// public/favicon.svg (hand-synced, same geometry on a 32 grid; the rasters are rendered from that file).
// Flat fills with opacity only (no gradient ids), so any number of copies can sit on one page.
export function NavLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="MintRadar" role="img" className={className}>
      <circle cx="16" cy="16" r="13" fill="var(--surface)" />
      <path d="M16 16 L8.29 6.81 A12 12 0 0 1 11.9 4.72 Z" fill="var(--accent)" opacity="0.07" />
      <path d="M16 16 L11.9 4.72 A12 12 0 0 1 16 4 Z" fill="var(--accent)" opacity="0.14" />
      <path d="M16 16 L16 4 A12 12 0 0 1 20.1 4.72 Z" fill="var(--accent)" opacity="0.25" />
      <path d="M16 16 L20.1 4.72 A12 12 0 0 1 23.71 6.81 Z" fill="var(--accent)" opacity="0.4" />
      <path d="M16 16 L23.71 6.81 A12 12 0 0 1 26.39 10 Z" fill="var(--accent)" opacity="0.58" />
      <circle cx="16" cy="16" r="13" stroke="var(--accent)" strokeWidth="1.7" />
      <circle cx="16" cy="16" r="6.5" stroke="var(--accent)" strokeWidth="0.8" opacity="0.35" />
      <path d="M16 16 L26.39 10" stroke="color-mix(in srgb, var(--accent) 65%, #fff)" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.7" fill="color-mix(in srgb, var(--accent) 65%, #fff)" />
      <circle cx="10.2" cy="20.6" r="3.6" fill="var(--copper)" opacity="0.25" />
      <circle cx="10.2" cy="20.6" r="1.9" fill="var(--copper)" />
    </svg>
  )
}
