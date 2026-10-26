// Browser-side network rules for every context: localhost passes, the third parties the app
// calls directly (Google Fonts, the room QR code) get a harmless answer, anything else is
// aborted and recorded as a leak (the guard fails the test on it). The vendored card
// renderer is swapped for a stub (fakes/renderer-stub.js).
import { RENDERER_STUB } from '../fakes/renderer-stub.js'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
// 1×1 transparent PNG, same as the fake CDN's.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

export async function installNetworkRules(context, leaks) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.protocol === 'blob:' || LOCAL_HOSTS.has(url.hostname)) return route.fallback()
    if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    if (url.hostname === 'fonts.gstatic.com') return route.abort()
    // The Lobby's share QR code (src/pages/Lobby.jsx) is an <img> from this public API.
    if (url.hostname === 'api.qrserver.com') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    leaks.push(url.href)
    return route.abort()
  })
  // Registered last so it is matched first.
  await context.route('**/altered-card-renderer.min.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: RENDERER_STUB }))
}
