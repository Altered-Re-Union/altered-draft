// Local QR code generation (no network request): the text becomes one SVG path.
import qrcode from 'qrcode-generator'

// Blank modules around the code, per the QR spec.
export const QR_QUIET_ZONE = 4

// Returns { size, d }: the viewBox side (modules + quiet zone on both sides) and a
// path with one 1x1 square per dark module.
export function qrSvgPath(text, { level = 'M' } = {}) {
  if (typeof text !== 'string' || text === '') throw new Error('qrSvgPath: empty text')
  const qr = qrcode(0, level)
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  let d = ''
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) d += `M${col + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h1v1h-1z`
    }
  }
  return { size: count + 2 * QR_QUIET_ZONE, d }
}
