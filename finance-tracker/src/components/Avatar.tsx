const GRADIENTS = [
  'linear-gradient(135deg,#8B5CF6,#6D28D9)',
  'linear-gradient(135deg,#EC4899,#DB2777)',
  'linear-gradient(135deg,#10B981,#059669)',
  'linear-gradient(135deg,#F59E0B,#D97706)',
  'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#06B6D4,#0891B2)',
]

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h * 31) + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

interface AvatarProps {
  name: string
  avatarUrl?: string | null
  size?: number
}

export function Avatar({ name, avatarUrl, size = 34 }: AvatarProps) {
  const isPhoto = !!(avatarUrl && (avatarUrl.startsWith('data:') || avatarUrl.startsWith('http')))
  const isEmoji = !!(avatarUrl && !isPhoto)
  const gradient = GRADIENTS[hashName(name || '?') % GRADIENTS.length]

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
      background: isPhoto ? 'transparent' : gradient,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 0 0 2px rgba(139,92,246,0.25)',
    }}>
      {isPhoto
        ? <img src={avatarUrl!} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
        : isEmoji
        ? <span style={{ fontSize: size * 0.56, lineHeight: 1 }}>{avatarUrl}</span>
        : <span style={{ color: 'white', fontWeight: 700, fontSize: size * 0.38, lineHeight: 1 }}>
            {name?.[0]?.toUpperCase() ?? '?'}
          </span>
      }
    </div>
  )
}
