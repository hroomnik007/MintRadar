// Shared shield mark used by the Trust Score badge (MintCard, ComparisonModal)
// and the Token Inspector's mint risk badge (Tools.tsx).
export function IcShield({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M7 1.2 1.9 3.1v4c0 3 2.1 4.9 5.1 5.7 3-.8 5.1-2.7 5.1-5.7v-4L7 1.2Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
    </svg>
  )
}
