// DT_GitManager에서 흡수. 커밋 작성자 이니셜 + 시드 기반 결정적 아바타 색(순수).
import { PALETTE } from './graphMetrics'

/** First visible character of a name, uppercased; '?' when empty. */
export function initial(name: string): string {
  const ch = name.trim()[0]
  return ch ? ch.toUpperCase() : '?'
}

/** Deterministic avatar background color from a seed (email/name), cycling the graph palette. */
export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}
