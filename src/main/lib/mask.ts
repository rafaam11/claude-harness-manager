import { TRANSLATION_GLOSSARY } from "../config.js";

/**
 * 번역 전 보호(masking) — 전문용어·고유명사를 영어로 유지하기 위한 모듈.
 * 코드/URL/명령어/고유명사를 영숫자 placeholder로 치환했다가 번역 후 복원한다.
 * placeholder는 순수 영숫자 토큰(`<prefix><n>X`)이라 DeepL 토큰화에도 원형이 보존되기 쉽고,
 * 유일 정수 id라 순서·중복 무관하게 복원된다. (특수문자 토큰은 번역 중 분해/공백삽입 위험.)
 */

export interface MaskResult {
  masked: string;
  restore: (translated: string) => string;
  tokenCount: number;
  prefix: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 입력에 존재하지 않는 placeholder prefix를 고른다(충돌 회피). */
function pickPrefix(input: string): string {
  let prefix = "Z9Q7K";
  while (input.includes(prefix)) prefix += "Q";
  return prefix;
}

export function maskText(input: string): MaskResult {
  const tokens: string[] = [];
  const prefix = pickPrefix(input);
  const ph = (piece: string): string => {
    const id = tokens.length;
    tokens.push(piece);
    return `${prefix}${id}X`;
  };
  let text = input;

  // 적용 순서 중요: 긴/구조적 패턴을 먼저 빼낸다.
  // 1) fenced code block
  text = text.replace(/```[\s\S]*?```/g, (m) => ph(m));
  // 2) inline code
  text = text.replace(/`[^`\n]+`/g, (m) => ph(m));
  // 3) raw HTML 태그(README 정렬/뱃지용 <p align>, <picture>, <img> 등) — 태그 전체를 한 단위로 보호
  text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?\/?>/g, (m) => ph(m));
  // 4) 마크다운 링크 URL부만(텍스트는 번역 허용): ](url)
  text = text.replace(/\]\(([^)\s]+)\)/g, (_m, url: string) => `](${ph(url)})`);
  // 5) autolink <http...>
  text = text.replace(/<https?:\/\/[^>\s]+>/g, (m) => ph(m));
  // 6) 맨몸 URL
  text = text.replace(/https?:\/\/[^\s)]+/g, (m) => ph(m));
  // 7) 플래그/옵션(--resume, -p) — 앞 공백/줄머리는 보존
  text = text.replace(
    /(^|\s)(--?[A-Za-z][\w-]*)/g,
    (_m, pre: string, flag: string) => `${pre}${ph(flag)}`,
  );
  // 8) 슬래시 커맨드(/rewind)
  text = text.replace(
    /(^|\s)(\/[a-z][a-z0-9-]*)/g,
    (_m, pre: string, cmd: string) => `${pre}${ph(cmd)}`,
  );

  // 9) 고유명사 화이트리스트(길이 내림차순 → "Claude Code"가 "Claude"보다 우선)
  const terms = [...TRANSLATION_GLOSSARY].sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, "g");
    text = text.replace(re, (m) => ph(m));
  }

  // 복원: DeepL이 토큰 사이에 공백을 끼워도 흡수하는 관대한 정규식.
  const restoreRe = new RegExp(`${prefix}\\s*(\\d+)\\s*X`, "g");
  const restore = (translated: string): string =>
    translated.replace(restoreRe, (_m, n: string) => tokens[Number(n)] ?? "");

  return { masked: text, restore, tokenCount: tokens.length, prefix };
}

/** 복원 검증: placeholder가 복원 후에도 남아있으면(토큰 변형) 실패로 본다. */
export function isRestoreValid(m: MaskResult, restored: string): boolean {
  if (m.tokenCount === 0) return true;
  return !restored.includes(m.prefix);
}
