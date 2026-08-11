import { useEffect, useState } from 'react'
import { useLang } from '../lib/i18n/i18n.jsx'

export default function PickTimer({ deadline, isMyTurn, onTimeout }) {
  const [remaining, setRemaining] = useState(null)
  const { t } = useLang()

  useEffect(() => {
    if (!deadline) { setRemaining(null); return }

    function tick() {
      const isoStr = String(deadline).split('|')[0]
      const ms = new Date(isoStr).getTime() - Date.now()
      setRemaining(Math.max(0, Math.ceil(ms / 1000)))
      if (ms <= 0 && isMyTurn) onTimeout()
    }

    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [deadline, isMyTurn, onTimeout])

  if (remaining === null) return null

  const pct = Math.min(100, Math.max(0, (remaining / totalSeconds(deadline)) * 100))
  const urgent = remaining <= 10

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-mono font-bold ${urgent ? 'text-red-400 animate-pulse' : 'text-muted'}`}>
          {remaining}s
        </span>
        {isMyTurn && (
          <span className="text-xs text-faint">{t('pickTimer.autoPickIn', { n: remaining })}</span>
        )}
      </div>
      <div className="h-1.5 bg-surface2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${urgent ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// Estimate total seconds from deadline by looking at how far in the future it was set
// We store totalSeconds in the deadline string as a suffix: "2024-01-01T00:00:00.000Z|60"
function totalSeconds(deadline) {
  if (!deadline) return 60
  const parts = String(deadline).split('|')
  return parts[1] ? Number(parts[1]) : 60
}

export function makeDeadline(seconds) {
  const ts = new Date(Date.now() + seconds * 1000).toISOString()
  return `${ts}|${seconds}`
}

export function deadlineDate(deadline) {
  if (!deadline) return null
  return new Date(String(deadline).split('|')[0])
}
