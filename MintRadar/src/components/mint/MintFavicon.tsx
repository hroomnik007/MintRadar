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

  const iconSize = size * 0.64

  return (
    <div
      className={className}
      style={{
        width: size, height: size, minWidth: size,
        borderRadius: radius, background: 'var(--bg3)',
        border: '0.5px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        role="img"
        aria-label={`${hostname} mint icon placeholder`}
      >
        <circle cx="12" cy="12" r="9" fill="var(--copper-soft)" stroke="var(--copper)" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="6.2" fill="none" stroke="var(--copper)" strokeWidth="1" opacity="0.45" />
        <path d="M7 15.5a6.9 6.9 0 0 0 10 0" fill="none" stroke="var(--copper)" strokeWidth="1" strokeLinecap="round" opacity="0.3" />
      </svg>
    </div>
  )
}
