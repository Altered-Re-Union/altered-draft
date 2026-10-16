// Saves the deck being built on a sealed pool to decks-api and links it to the pool
// (TournamentPoolView.jsx's throttled sync). Pure orchestration, decks-api / altered-draft
// calls injected.
//
// Order matters for a NEW deck: decks-api validates a non-draft sealed deck as soon as it
// is saved, by asking altered-draft for the pool linked to that deck id — a link that only
// exists once syncPoolDeck has run. Creating an already-valid deck (e.g. "Random deck",
// 30 cards at once) as non-draft would fail that lookup, store the deck as illegal and
// cache the failure for 30 s. So a new deck is created as a DRAFT, linked, and only then
// flipped off draft (decks-api re-validates on that PATCH, with the link in place) — the
// same sequence as the backend's ensureDeck (api/_lib/tournamentPool.js).

/**
 * @param {object} p
 * @param {string} p.poolId
 * @param {string|null} p.deckId - the deck currently linked to the pool, if any
 * @param {{ name, deckCards, isDraft, format }} p.summary - isDraft = !valid
 * @param {string|null} p.heroRef
 * @param {string|null} p.faction
 * @param {number} p.cardQuantity
 * @param {{ createDeck, updateDeck, syncPoolDeck }} deps - src/lib/decks.js + tournamentApi.js
 * @returns {Promise<object>} the updated pool (syncPoolDeck's response)
 */
export async function syncDeckToPool({ poolId, deckId, summary, heroRef, faction, cardQuantity }, { createDeck, updateDeck, syncPoolDeck }) {
  const link = id => syncPoolDeck(poolId, { deckId: id, name: summary.name, heroRef, faction, cardQuantity })

  if (deckId) {
    try {
      await updateDeck(deckId, summary)
      return await link(deckId)
    } catch (e) {
      // The deck we last synced to was deleted server-side (e.g. from the deckbuilder):
      // recreate it below instead of repeating this same 404 on every future edit.
      if (e.status !== 404) throw e
    }
  }

  const created = await createDeck({ ...summary, isDraft: true })
  const pool = await link(created.id)
  if (!summary.isDraft) await updateDeck(created.id, { isDraft: false })
  return pool
}
