import path from "node:path";
import { ALLOWED_ROOTS } from "../config.js";

export class PathViolationError extends Error {
  statusCode = 403;
}

/**
 * resolve 후 allowlist prefix 검사. 통과하면 정규화된 절대 경로를 반환한다.
 * 모든 파일 연산은 이 함수를 통과한 경로만 사용한다.
 */
export function guardPath(candidate: string): string {
  const resolved = path.resolve(candidate);
  const ok = ALLOWED_ROOTS.some((root) => {
    const r = path.resolve(root);
    if (resolved === r) return true;
    return resolved.startsWith(r + path.sep);
  });
  if (!ok) {
    throw new PathViolationError(`path not allowed: ${resolved}`);
  }
  return resolved;
}
