// DT_GitManager에서 흡수. unix-seconds를 한국어 상대 시간으로(30일 넘으면 YYYY-MM-DD).
const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Local YYYY-MM-DD for the given unix-seconds instant. */
function isoDate(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Formats a unix-seconds timestamp as a Korean relative time ("3분 전"), falling
 * back to a YYYY-MM-DD date past 30 days. `now` (unix seconds) is injectable for tests.
 */
export function relativeTime(epochSeconds: number, now = Date.now() / 1000): string {
  const diff = now - epochSeconds
  if (diff < MINUTE) return '방금 전'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`
  if (diff < MONTH) return `${Math.floor(diff / DAY)}일 전`
  return isoDate(epochSeconds)
}
