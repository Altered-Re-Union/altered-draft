// Dates for the tournament form (datetime-local, read in Europe/Paris like the browser
// context) and for API bodies (ISO).
const TZ = 'Europe/Paris'
const DAY = 864e5

export function parisDate(offsetDays) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offsetDays * DAY))
}

export function localDateTime(offsetDays, hhmm = '20:00') {
  return `${parisDate(offsetDays)}T${hhmm}`
}

export function isoDaysFromNow(days, hours = 0) {
  return new Date(Date.now() + days * DAY + hours * 36e5).toISOString()
}
