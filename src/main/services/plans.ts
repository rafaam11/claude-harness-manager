import fs from "node:fs/promises";
import path from "node:path";
import { PLANS_DIR, PLANS_ARCHIVE_DIR } from "../config.js";
import { guardPath } from "../lib/path-guard.js";

/**
 * ~/.claude/plans 의 계획 .md 파일을 스캔한다.
 * frontmatter가 없으므로 제목은 첫 `# ` 헤딩에서 추출(없으면 파일명).
 */
export interface PlanInfo {
  filename: string;
  title: string;
  path: string;
  mtime: number;
  size: number;
  archived: boolean;
}

const TITLE_SNIFF_BYTES = 8 * 1024;
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const CONTENT_HEAD_BYTES = 256 * 1024;

async function readTitle(p: string, fallback: string): Promise<string> {
  try {
    const fh = await fs.open(p, "r");
    const buf = Buffer.alloc(TITLE_SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    const m = buf.toString("utf8", 0, bytesRead).match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : fallback;
  } catch {
    return fallback;
  }
}

async function scanDir(dir: string, archived: boolean): Promise<PlanInfo[]> {
  const out: PlanInfo[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue; // _archive 디렉토리 등은 스킵
    const p = path.join(dir, entry.name);
    const stat = await fs.stat(p).catch(() => null);
    if (!stat) continue;
    out.push({
      filename: entry.name,
      title: await readTitle(p, entry.name.replace(/\.md$/, "")),
      path: p,
      mtime: stat.mtimeMs,
      size: stat.size,
      archived,
    });
  }
  return out;
}

export async function getPlans(includeArchived = false): Promise<PlanInfo[]> {
  const active = await scanDir(PLANS_DIR, false);
  const all = includeArchived
    ? active.concat(await scanDir(PLANS_ARCHIVE_DIR, true))
    : active;
  return all.sort((a, b) => b.mtime - a.mtime);
}

export async function readPlanContent(filename: string, archived: boolean) {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw Object.assign(new Error("invalid plan filename"), { statusCode: 400 });
  }
  const base = archived ? PLANS_ARCHIVE_DIR : PLANS_DIR;
  const p = guardPath(path.join(base, filename));
  const stat = await fs.stat(p);
  let raw: string;
  let truncated = false;
  if (stat.size > MAX_CONTENT_BYTES) {
    const fh = await fs.open(p, "r");
    const buf = Buffer.alloc(CONTENT_HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    raw = buf.toString("utf8", 0, bytesRead);
    truncated = true;
  } else {
    raw = await fs.readFile(p, "utf8");
  }
  return { raw, mtime: stat.mtimeMs, size: stat.size, truncated };
}
