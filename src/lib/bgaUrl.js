// A BGA tournament link as pasted by an organizer, reduced to its tournament id. Only
// boardgamearena.com (any locale subdomain) over https with a numeric `id` is accepted:
// the list of tournaments is public, so the stored link must never be an arbitrary URL.
const BGA_HOST = /(^|\.)boardgamearena\.com$/i

/**
 * @param {unknown} input
 * @returns {{ id: string, url: string } | null} the numeric id and the canonical link
 */
export function parseBgaTournamentUrl(input) {
  let url
  try {
    url = new URL(String(input ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (!BGA_HOST.test(url.hostname)) return null
  if (!/^\/tournament\/?$/.test(url.pathname)) return null
  const id = url.searchParams.get('id')
  if (!id || !/^\d+$/.test(id)) return null
  return { id, url: `https://boardgamearena.com/tournament?id=${id}` }
}
