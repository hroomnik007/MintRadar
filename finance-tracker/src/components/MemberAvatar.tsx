const MEMBER_COLORS = [
  'linear-gradient(135deg, #7C3AED, #6D28D9)',
  'linear-gradient(135deg, #ec4899, #db2777)',
  'linear-gradient(135deg, #10b981, #059669)',
  'linear-gradient(135deg, #f59e0b, #d97706)',
  'linear-gradient(135deg, #3b82f6, #2563eb)',
]

function hashUserId(userId: string): number {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash * 31) + userId.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

interface MemberAvatarProps {
  userId: string
  userName: string
  size?: number
  avatarUrl?: string | null
}

export function MemberAvatar({ userId, userName, size = 24, avatarUrl }: MemberAvatarProps) {
  const color = MEMBER_COLORS[hashUserId(userId) % MEMBER_COLORS.length]
  const initials = userName.charAt(0).toUpperCase()

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={userName}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        color: 'white',
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  )
}
