// Clipboard + Web Share helpers, shared by ExportMenu and the tournament share box.

/** Copies text; resolves false when empty or when every method is refused. */
export async function copyText(text) {
  if (!text) return false
  try { await navigator.clipboard.writeText(text); return true }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch { return false }
  }
}

export function canNativeShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

/** true when the share sheet resolved; false when unsupported or dismissed/rejected. */
export async function nativeShare({ title, url }) {
  if (!canNativeShare()) return false
  try { await navigator.share({ title, url }); return true }
  catch { return false }
}

export function tournamentShareUrl(id, origin = window.location.origin) {
  return `${origin}/tournament/t/${id}`
}
