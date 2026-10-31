import { MAX_UNIQUES } from '../lib/tournamentConfig.js'

// A small "− value +" counter, clamped to [min, max]. `format` renders the value
// (the set weights show "×2", in a wider cell); the test id lands on the wrapper.
export default function Stepper({ value, onChange, min = 0, max = MAX_UNIQUES, disabled, testId, format = null }) {
  return (
    <div data-testid={testId} className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">−</button>
      <span className={`${format ? 'w-8' : 'w-6'} text-center text-sm font-bold text-ink tabular-nums`}>{format ? format(value) : value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">+</button>
    </div>
  )
}
