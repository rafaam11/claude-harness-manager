// win32·darwin은 기본 파일시스템이 대소문자를 무시하므로 소문자화로 동일 경로를 접고,
// Linux는 대소문자만 다른 별개 경로가 존재할 수 있으므로 케이스를 보존한다.
const CASE_INSENSITIVE_FS = process.platform !== "linux";

/** 경로를 비교/그룹핑 키로 정규화한다(구분자 통일 · 후행 슬래시 제거 · 플랫폼별 케이스 처리). */
export function normalizePathKey(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return CASE_INSENSITIVE_FS ? s.toLowerCase() : s;
}
