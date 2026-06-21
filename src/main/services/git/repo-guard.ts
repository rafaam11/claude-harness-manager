// git 전용 안전 가드. harness의 path-guard(guardPath)는 ~/.claude allowlist 전용이라
// 임의 repo 경로에는 항상 403이 난다. git 작업 대상은 "실제 .git을 가진 절대경로"여야 하므로
// 여기서 별도로 검증한다(rev-parse --show-toplevel 성공 + 옵션 오인 방지).
import path from "node:path";
import { resolveRepoRoot } from "./GitService.js";

/**
 * 후보 경로를 검증해 git 저장소 toplevel 절대경로를 반환한다. 부적격이면 null.
 *  - 빈 문자열 / `-`로 시작(git이 옵션으로 오인) 거부
 *  - rev-parse --show-toplevel 성공해야 함(실제 work tree 안)
 * 반환한 toplevel만 이후 모든 git 호출의 cwd로 쓴다(요청이 보낸 원시 경로를 직접 쓰지 않는다).
 */
export async function assertGitRepo(candidate: string | null | undefined): Promise<string | null> {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.startsWith("-")) return null;
  const abs = path.resolve(trimmed);
  return resolveRepoRoot(abs);
}
