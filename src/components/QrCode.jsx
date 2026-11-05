import { useMemo } from 'react'
import { qrSvgPath } from '../lib/qr.js'

// Always black modules on a white tile (literal #000 / #fff, not theme tokens):
// the one deliberate exception to the semantic-tokens rule, so the code stays
// scannable in dark theme.
export default function QrCode({ value, label, size = 120, className = '', testId = 'qr-code' }) {
  const { size: n, d } = useMemo(() => qrSvgPath(value), [value])
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={`rounded-lg ${className}`}
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}
