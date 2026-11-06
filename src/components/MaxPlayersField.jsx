import { useLang } from '../lib/i18n/i18n.jsx'
import { FACTION_NAMES } from '../lib/cardData.js'
import { CUBE_LIMITS } from '../lib/cubeSealed.js'

/** "56 Yzmir cards, 7 needed per player": the term of `cubeCapacity` that limits the players. */
export function capacityLimitText(limit, t) {
  if (!limit) return ''
  return limit.by === 'total'
    ? t('tournaments.capacityLimitTotal', { have: limit.have, needed: limit.needed })
    : t('tournaments.capacityLimitFaction', { have: limit.have, needed: limit.needed, faction: FACTION_NAMES[limit.by] ?? limit.by })
}

// The player cap of a tournament (spec §15.2 "Player cap"): optional on every source ("No
// limit" when empty), required for a cube, whose capacity is shown live under the input.
// `value` is '' or what was typed; the form turns it into the API's `maxPlayers`.
export default function MaxPlayersField({ value, onChange, onBlur, required = false, capacity = null, disabled = false, resolving = false, invalid = false }) {
  const { t } = useLang()
  const limit = capacity ? capacityLimitText(capacity.limit, t) : ''
  return (
    <div className="space-y-1">
      <label className="block text-sm text-ink2" htmlFor="tn-max-players">{t('tournaments.maxPlayersLabel')}</label>
      <input id="tn-max-players" data-testid="max-players" type="number" inputMode="numeric" step={1}
        min={2} max={capacity?.players ?? CUBE_LIMITS.maxPlayers}
        value={value} disabled={disabled} required={required} aria-invalid={invalid}
        placeholder={required ? undefined : t('tournaments.maxPlayersNoLimit')}
        aria-describedby="tn-max-players-hint"
        onChange={e => onChange(e.target.value)} onBlur={onBlur}
        className={`w-32 bg-surface2 border rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none disabled:opacity-60 ${
          invalid ? 'border-danger focus:border-danger' : 'border-line focus:border-accent'}`} />
      {resolving && <p className="text-xs text-muted" role="status">{t('tournaments.cubeCapacityPending')}</p>}
      {capacity && (capacity.players < 2
        ? <p data-testid="max-players-capacity" className="text-xs text-danger">{t('tournaments.errCubeTooSmall', { limit })}</p>
        : (
          <p className="text-xs text-ink2">
            <span data-testid="max-players-capacity">{t('tournaments.cubeCapacityLine', { n: capacity.players })}</span>{' '}
            <span data-testid="max-players-limit">{t('tournaments.cubeCapacityLimit', { limit })}</span>
          </p>
        ))}
      <p id="tn-max-players-hint" className="text-xs text-faint">
        {required ? `${t('tournaments.maxPlayersCubeHint')} ${t('tournaments.maxPlayersHint')}` : t('tournaments.maxPlayersHint')}
      </p>
    </div>
  )
}
