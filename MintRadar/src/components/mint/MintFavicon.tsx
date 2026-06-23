import { useState } from 'react'

interface Props {
  url: string
  iconUrl?: string | null
  size?: number
  radius?: number
  className?: string
}

export function MintFavicon({ url, iconUrl, size = 22, radius = 5, className = '' }: Props) {
  const hostname = (() => { try { return new URL(url).hostname } catch { return url } })()
  const letter = hostname[0]?.toUpperCase() ?? '?'
  const [imgFailed, setImgFailed] = useState(false)

  if (iconUrl && !imgFailed) {
    return (
      <img
        src={iconUrl}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{
          width: size, height: size, minWidth: size,
          borderRadius: radius, objectFit: 'contain',
          background: 'var(--bg3)', border: '0.5px solid var(--border)',
        }}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={className}
      style={{
        width: size, height: size, minWidth: size,
        borderRadius: radius, background: 'var(--bg3)',
        border: '0.5px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.5, color: 'var(--text3)',
        fontFamily: 'var(--font-mono)', textTransform: 'uppercase', flexShrink: 0,
      }}
    >
      {letter}
    </div>
  )
}
