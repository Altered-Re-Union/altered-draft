// Winston board. **Honor-system rendering:** pile contents are revealed ONLY to the player
// whose turn it is, and ONLY for the pile they're currently looking at (peekIndex). Everyone
// else — and every other pile — is shown face-down as a count. The pile refs live in shared
// state, so this component is what keeps the hidden info hidden; never render a pile's cards
// to a player who shouldn't see them.

import ZoomCard from './ZoomCard.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'

function nextNonEmpty(piles, from) {
  for (let k = from; k < piles.length; k++) if (piles[k].length) return k
  return -1
}

// A face-down pile/deck rendered as a stack of card backs with a big card count.
// `highlight` rings the pile the active player is currently looking at.
function FaceDown({ label, count, highlight }) {
  const { tc } = useLang()
  const W = 'w-24 sm:w-28'
  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`relative ${W}`}>
        {/* offset backs behind, so a fuller pile reads as a thicker stack */}
        {count > 2 && <div className={`absolute left-2 top-2 ${W} aspect-[2/3] rounded-xl border border-line bg-surface2/50`} />}
        {count > 1 && <div className={`absolute left-1 top-1 ${W} aspect-[2/3] rounded-xl border border-line bg-surface2/70`} />}
        <div className={`relative ${W} aspect-[2/3] rounded-xl border flex flex-col items-center justify-center gap-0.5
          bg-gradient-to-br from-surface3 to-surface2 ${highlight ? 'border-accent ring-2 ring-accent/60' : 'border-line'}`}>
          <span className="text-3xl text-faint/25 font-display select-none leading-none">A</span>
          <span className="text-3xl sm:text-4xl font-bold text-ink leading-none tabular-nums">{count}</span>
          <span className="text-[10px] text-faint uppercase tracking-widest">{tc('winstonBoard.cardCount', count).replace(/^\d+\s*/, '')}</span>
        </div>
      </div>
      <span className={`text-sm ${highlight ? 'text-accent font-semibold' : 'text-muted'}`}>{label}</span>
    </div>
  )
}

export default function WinstonBoard({ state, myIndex, cardMap, isMyTurn, onAction, disabled }) {
  const { t, tc } = useLang()
  const piles = state.piles ?? [[], [], []]
  const deckCount = state.deck?.length ?? 0
  const rawPeek = state.peekIndex ?? 0
  // Match the engine's normalization: if the stored peek pile is empty (end-game), the player
  // is really looking at the next non-empty pile.
  const peek = piles[rawPeek]?.length ? rawPeek : (nextNonEmpty(piles, rawPeek) === -1 ? rawPeek : nextNonEmpty(piles, rawPeek))
  const opponent = state.players?.[myIndex === 0 ? 1 : 0]?.name ?? t('winstonBoard.opponentFallback')
  const currentPile = piles[peek] ?? []

  // Passing is only offered when it does something distinct from taking: while the deck has
  // cards, or when there's another non-empty pile to move to. In the end-game's last pile you
  // must Take.
  const isLastPile = nextNonEmpty(piles, peek + 1) === -1
  const canPass = deckCount > 0 || !isLastPile
  const passLabel = deckCount > 0
    ? (peek >= piles.length - 1 ? t('winstonBoard.passDrawBlind') : t('winstonBoard.passAddCard'))
    : t('winstonBoard.passToNext')

  return (
    <div className="flex flex-col xl:flex-row xl:items-start gap-5 xl:gap-8">
      {/* Deck + piles (left) */}
      <div className="flex items-start gap-4 sm:gap-6 flex-wrap shrink-0">
        <FaceDown label={t('winstonBoard.deck')} count={deckCount} highlight={false} />
        <div className="w-px self-stretch bg-line hidden sm:block" />
        {piles.map((p, idx) => (
          <FaceDown key={idx} label={t('winstonBoard.pile', { n: idx + 1 })} count={p.length}
            highlight={isMyTurn && idx === peek} />
        ))}
      </div>

      {/* The pile you're looking at + actions (right; below the piles on narrow screens) */}
      <div className="flex-1 min-w-0 space-y-4">
        {isMyTurn ? (
          <div className="bg-surface border border-accent/30 rounded-xl p-4 space-y-3">
            <p className="text-sm text-ink2">
              {tc('winstonBoard.lookingAt', currentPile.length, {
                pile: t('winstonBoard.pile', { n: peek + 1 }),
                cards: tc('winstonBoard.cardCount', currentPile.length),
              })}
            </p>
            {currentPile.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {currentPile.map((ref, i) => <ZoomCard key={`${ref}-${i}`} ref_={ref} card={cardMap?.[ref]} width="w-32 sm:w-36" />)}
              </div>
            ) : (
              <p className="text-sm text-faint">{t('winstonBoard.pileEmpty')}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => onAction('take')} disabled={disabled || currentPile.length === 0}
                className="px-4 py-2 bg-accent hover:bg-accent2 disabled:opacity-40 text-on-accent font-bold rounded-lg text-sm transition-colors">
                {t('winstonBoard.takeThisPile')}
              </button>
              {canPass && (
                <button onClick={() => onAction('decline')} disabled={disabled}
                  className="px-4 py-2 bg-surface2 hover:bg-surface3 disabled:opacity-40 text-ink2 font-medium rounded-lg text-sm transition-colors">
                  {passLabel}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-surface border border-line rounded-lg px-4 py-3 text-sm text-muted">
            {t('winstonBoard.waitingForOpponent', { name: opponent })}
          </div>
        )}

        {/* The card you took blind off the deck (declined all three piles) — shown only to you. */}
        {state.lastBlind?.seat === myIndex && (
          <div className="bg-surface border border-accent/40 rounded-xl p-3 flex items-center gap-3">
            <ZoomCard ref_={state.lastBlind.ref} card={cardMap?.[state.lastBlind.ref]} width="w-28 sm:w-32" highlight />
            <div>
              <p className="text-sm text-accent font-semibold">{t('winstonBoard.drewOffDeckTitle')}</p>
              <p className="text-xs text-faint mt-0.5">
                {t('winstonBoard.drewOffDeckBody', { name: cardMap?.[state.lastBlind.ref]?.name ?? t('winstonBoard.randomCardFallback') })}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}