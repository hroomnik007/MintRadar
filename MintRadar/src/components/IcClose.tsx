// The one close "X" used by every dialog's close button (was a mix of ×, ✕ and X glyphs of different sizes).
export function IcClose({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
