// Generated booster cover for cube tournament pools (spec §15.5): no pack photo exists for a
// cube, so the reveal draws one on a canvas. The one place literal colours are allowed.

const cache = new Map()

/** Word-wrap `text` into at most `maxLines` lines of `maxChars`; the last line ends with `…` when cut. */
export function wrapTitle(text, maxChars = 18, maxLines = 2) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean)
  const cut = s => (s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s)
  const lines = []
  let cur = ''
  let i = 0
  for (; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]
    if (next.length <= maxChars || !cur) { cur = next; continue }
    if (lines.length === maxLines - 1) break // current line is the last one: the rest is cut
    lines.push(cur)
    cur = words[i]
  }
  if (!cur) return lines
  if (i < words.length) {
    // Words remain unplaced: ellipsize the last line.
    const room = cur.length + 1 > maxChars ? cur.slice(0, maxChars - 1) : cur
    lines.push(`${room.length + 1 > maxChars ? room.slice(0, maxChars - 1) : room}…`)
  } else lines.push(cut(cur))
  return lines
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo'))
    img.src = url
  })
}

async function loadFont() {
  try {
    await Promise.race([
      document.fonts.load('700 56px Fraunces'),
      new Promise(r => setTimeout(r, 2000)),
    ])
  } catch { /* fall back to serif */ }
}

/** @returns {Promise<string|null>} a PNG data URL, or null on any failure (never throws). */
export async function cubeBoosterCover({ title, subtitle, logoUrl = '/images/altered-logo.png', width = 600, height = 840 }) {
  const key = `${title}|${subtitle}`
  if (cache.has(key)) return cache.get(key)
  try {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    await loadFont()

    const bg = ctx.createLinearGradient(0, 0, 0, height)
    bg.addColorStop(0, '#0d2a4d')
    bg.addColorStop(1, '#071a33')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = '#d7b25c'
    ctx.lineWidth = 10
    ctx.strokeRect(5, 5, width - 10, height - 10)

    const logo = await loadImage(logoUrl)
    const lw = width * 0.6
    const lh = lw * (logo.naturalHeight / logo.naturalWidth || 1)
    ctx.drawImage(logo, (width - lw) / 2, Math.max(30, (height / 2 - lh) / 2), lw, lh)

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#d7b25c'
    ctx.font = '700 56px Fraunces, serif'
    const lines = wrapTitle(title)
    const top = height * 0.58
    lines.forEach((l, i) => ctx.fillText(l, width / 2, top + i * 68))
    ctx.fillStyle = '#f4ead0'
    ctx.font = '500 30px Fraunces, serif'
    ctx.fillText(String(subtitle ?? ''), width / 2, top + lines.length * 68 + 40, width - 60)

    const url = canvas.toDataURL('image/png')
    cache.set(key, url)
    return url
  } catch {
    return null
  }
}
