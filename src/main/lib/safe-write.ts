import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { BACKUP_DIR, BACKUP_KEEP } from "../config.js";
import { guardPath } from "./path-guard.js";
import { validateConfig } from "./json-validate.js";
import { withLock } from "./lock.js";

export class ConflictError extends Error {
  statusCode = 409;
}

export function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function readConfig(filePath: string) {
  const p = guardPath(filePath);
  const buf = await fs.readFile(p);
  const stat = await fs.stat(p);
  return { content: buf.toString("utf8"), mtime: stat.mtimeMs, sha256: sha256(buf) };
}

async function rotateBackups(prefix: string) {
  const entries = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const mine = entries.filter((e) => e.startsWith(prefix)).sort();
  while (mine.length > BACKUP_KEEP) {
    const oldest = mine.shift()!;
    await fs.rm(path.join(BACKUP_DIR, oldest), { force: true });
  }
}

/**
 * 쓰기 파이프라인: baseHash 대조 → 구조 검증 → 평문 .bak 백업(로테이션)
 * → 같은 볼륨 temp 파일 → atomic rename.
 */
export async function safeWrite(
  name: string,
  filePath: string,
  content: string,
  baseHash: string,
): Promise<{ sha256: string; backup: string }> {
  return withLock(async () => {
    const p = guardPath(filePath);

    const current = await fs.readFile(p);
    const currentHash = sha256(current);
    if (currentHash !== baseHash) {
      throw new ConflictError(
        "파일이 외부에서 변경되었습니다. 다시 불러온 뒤 수정하세요.",
      );
    }

    validateConfig(name, content);

    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${path.basename(p)}.${stamp}.bak`;
    const backupPath = path.join(BACKUP_DIR, backupName);
    await fs.writeFile(backupPath, current);
    await rotateBackups(path.basename(p) + ".");

    const tempPath = p + ".chm-tmp";
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, p);

    return { sha256: sha256(content), backup: backupName };
  });
}

export async function listBackups(fileBase: string) {
  const entries = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const mine = entries.filter((e) => e.startsWith(fileBase + ".")).sort().reverse();
  const out = [];
  for (const e of mine) {
    const stat = await fs.stat(path.join(BACKUP_DIR, e));
    out.push({ name: e, size: stat.size, mtime: stat.mtimeMs });
  }
  return out;
}

export async function restoreBackup(name: string, filePath: string, backupName: string) {
  return withLock(async () => {
    const p = guardPath(filePath);
    const backupPath = guardPath(path.join(BACKUP_DIR, backupName));
    const content = await fs.readFile(backupPath, "utf8");
    validateConfig(name, content);

    // 복원 직전 현재본도 백업으로 남긴다
    const current = await fs.readFile(p);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(
      path.join(BACKUP_DIR, `${path.basename(p)}.${stamp}.pre-restore.bak`),
      current,
    );

    const tempPath = p + ".chm-tmp";
    await fs.writeFile(tempPath, content, "utf8");
    await fs.rename(tempPath, p);
    return { sha256: sha256(content) };
  });
}
