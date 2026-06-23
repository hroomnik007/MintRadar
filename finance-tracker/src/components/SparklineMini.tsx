interface SparklineMiniProps {
  data: number[]
  color?: string
  width?: number
  height?: number
  id: string
}

export function SparklineMini({ data, color = 'var(--violet)', width = 80, height = 28, id }: SparklineMiniProps) {
  if (!data || data.length < 2) return null

  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 3) - 1.5
    return `${x},${y}`
  })

  const line = `M ${pts.join(' L ')}`
  const area = `M ${pts[0]} L ${pts.join(' L ')} L ${width},${height} L 0,${height} Z`
  const gid = `spm-${id}`

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
