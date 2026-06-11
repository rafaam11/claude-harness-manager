import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOME, STALE_DAYS } from "../config.js";
import { guardPath } from "../lib/path-guard.js";

export interface ProjectInfo {
  id: string; // flatten된 디렉토리명
  size: number;
  transcriptCount: number;
  memoryFileCount: number;
  lastActivity: number; // 가장 최근 mtime
  staleDays: number;
  originalPathExists: boolean | null; // flatten 역추정 불가 시 null
}

/** flatten된 디렉토리명(D--hdx-agv)에서 원본 경로 후보를 추정 */
function guessOriginalPath(id: string): string | null {
  const m = id.match(/^([A-Za-z])--(.+)$/);
  if (!m) return null;
  // '-'가 경로 구분자였는지 이름의 일부였는지 구분 불가 → 단순 추정만
  return `${m[1]}:\\${m[2].replace(/-/g, "\\")}`;
}

export async function getProjects(): Promise<ProjectInfo[]> {
  const projectsDir = path.join(CLAUDE_HOME, "projects");
  const out: ProjectInfo[] = [];

  for (const entry of await fs.readdir(projectsDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(projectsDir, entry.name);
    let size = 0;
    let transcriptCount = 0;
    let memoryFileCount = 0;
    let lastActivity = 0;

    async function walk(d: string) {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          await walk(p);
        } else {
          const stat = await fs.stat(p).catch(() => null);
          if (!stat) continue;
          size += stat.size;
          if (stat.mtimeMs > lastActivity) lastActivity = stat.mtimeMs;
          if (e.name.endsWith(".jsonl")) transcriptCount++;
          if (p.includes(`${path.sep}memory${path.sep}`)) memoryFileCount++;
        }
      }
    }
    await walk(dir);

    const guessed = guessOriginalPath(entry.name);
    let originalPathExists: boolean | null = null;
    if (guessed) {
      originalPathExists = await fs
        .access(guessed)
        .then(() => true)
        .catch(() => false);
    }

    out.push({
      id: entry.name,
      size,
      transcriptCount,
      memoryFileCount,
      lastActivity,
      staleDays: lastActivity ? Math.floor((Date.now() - lastActivity) / 86400000) : -1,
      originalPathExists,
    });
  }
  return out.sort((a, b) => b.staleDays - a.staleDays);
}

export async function listProjectFiles(id: string) {
  const dir = guardPath(path.join(CLAUDE_HOME, "projects", id));
  const files: { path: string; size: number; mtime: number }[] = [];
  async function walk(d: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const stat = await fs.stat(p).catch(() => null);
        if (stat) files.push({ path: path.relative(dir, p), size: stat.size, mtime: stat.mtimeMs });
      }
    }
  }
  await walk(dir);
  return files;
}

export async function readProjectFile(id: string, relPath: string) {
  const p = guardPath(path.join(CLAUDE_HOME, "projects", id, relPath));
  const stat = await fs.stat(p);
  if (stat.size > 2 * 1024 * 1024) {
    // 대형 트랜스크립트는 앞부분만
    const fh = await fs.open(p, "r");
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    return { content: buf.toString("utf8", 0, bytesRead), truncated: true, size: stat.size };
  }
  return { content: await fs.readFile(p, "utf8"), truncated: false, size: stat.size };
}

export { STALE_DAYS };
