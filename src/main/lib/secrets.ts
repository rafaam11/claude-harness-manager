import fs from "node:fs/promises";
import path from "node:path";
import { SECRET_FILE } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";

/**
 * 앱 소유 시크릿 저장소(현재 DeepL API 키). board.json과 분리한다 —
 * board는 .bak 로테이션에 평문이 누적되므로, 시크릿은 별 파일 + **백업 제외** + chmod 0600.
 * 키 원문은 main 안에서만 다루고 renderer에는 존재 여부(boolean)만 노출한다(MCP 시크릿 정책).
 */

interface SecretsFile {
  version: 1;
  deeplKey?: string;
}

function emptySecrets(): SecretsFile {
  return { version: 1 };
}

/** 신뢰할 수 없는 파일 내용을 화이트리스트로 정제. */
function sanitize(parsed: unknown): SecretsFile {
  const s = emptySecrets();
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    if (typeof p.deeplKey === "string" && p.deeplKey) s.deeplKey = p.deeplKey;
  }
  return s;
}

export async function readSecrets(): Promise<SecretsFile> {
  const p = guardPath(SECRET_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptySecrets();
    throw e;
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    // 손상본은 옆에 보관하고 빈 시크릿으로 생존(board.ts와 동일).
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${SECRET_FILE}.corrupt.${stamp}`)).catch(() => {});
    return emptySecrets();
  }
}

// 평문 키가 BACKUP_DIR에 누적되지 않도록 .bak 백업을 생략한다(secrets.json 분리의 본래 이유).
async function writeSecretsAtomic(data: SecretsFile): Promise<void> {
  const p = guardPath(SECRET_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tempPath = p + ".chm-tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, p);
  await fs.chmod(p, 0o600).catch(() => {}); // POSIX 한정 권한 축소(Windows no-op)
}

/** main 전용 — 키 원문을 반환하므로 router에서 직접 호출 금지(translate.ts만 사용). */
export async function getDeepLKey(): Promise<string | undefined> {
  return (await readSecrets()).deeplKey;
}

/** 키 존재 여부만(router/renderer 노출용). 키 원문은 새지 않는다. */
export async function hasDeepLKey(): Promise<boolean> {
  return Boolean(await getDeepLKey());
}

/** 키 저장. 빈 문자열/공백이면 해제(키 삭제). */
export async function setDeepLKey(key: string): Promise<void> {
  return withLock(async () => {
    const s = await readSecrets();
    const trimmed = key.trim();
    if (trimmed) s.deeplKey = trimmed;
    else delete s.deeplKey;
    await writeSecretsAtomic(s);
  });
}
