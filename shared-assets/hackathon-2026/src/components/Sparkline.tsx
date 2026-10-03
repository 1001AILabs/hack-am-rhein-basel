import type { CSSProperties } from 'react'

type Props = {
  data: number[]
  color?: string
  width?: number
  height?: number
  ariaLabel?: string
  style?: CSSProperties
}

export function Sparkline({
  data,
  color = 'currentColor',
  width = 80,
  height = 32,
  ariaLabel,
  style,
}: Props) {
  if (!data || data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label={ariaLabel || 'sparkline unavailable'}
        style={style}
        role="img"
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={1}
          strokeDasharray="2 3"
          opacity={0.4}
        />
      </svg>
    )
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 2
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0

  const points = data.map((v, i) => {
    const x = pad + i * step
    const y = pad + (1 - (v - min) / range) * (height - pad * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const lastPoint = points[points.length - 1].split(',')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={ariaLabel || `trend of ${data.length} points`}
      style={style}
      role="img"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={lastPoint[0]}
        cy={lastPoint[1]}
        r={3}
        fill={color}
      />
    </svg>
  )
}

export default Sparkline
