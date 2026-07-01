import fs from "node:fs/promises";
import path from "node:path";
import { PLANS_DIR, PLANS_ARCHIVE_DIR } from "../config.js";
import { guardPath } from "../lib/path-guard.js";

/**
 * ~/.claude/plans 의 계획 .md 파일을 스캔한다.
 * frontmatter가 없으므로 제목은 첫 `# ` 헤딩에서 추출(없으면 파일명).
 * sessionId는 stamp-plan-session.mjs 훅이 파일 맨 앞에 새겨넣는 `<!-- claude-session: ... -->`
 * 마커에서 추출한다(훅 미설치 환경이거나 훅 이전에 만들어진 계획은 null — recall.ts가 시간 근접
 * 휴리스틱으로 폴백한다).
 */
export interface PlanInfo {
  filename: string;
  title: string;
  path: string;
  mtime: number;
  size: number;
  archived: boolean;
  sessionId: string | null;
}

const TITLE_SNIFF_BYTES = 8 * 1024;
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const CONTENT_HEAD_BYTES = 256 * 1024;
// 파일 맨 앞만 매칭(non-multiline) — 본문 어딘가에 이 문자열이 인용돼 있어도 오탐하지 않는다.
const SESSION_MARKER_RE = /^<!--\s*claude-session:\s*([A-Za-z0-9_-]+)\s*-->/;

async function readMeta(
  p: string,
  fallbackTitle: string,
): Promise<{ title: string; sessionId: string | null }> {
  try {
    const fh = await fs.open(p, "r");
    const buf = Buffer.alloc(TITLE_SNIFF_BYTES);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    const head = buf.toString("utf8", 0, bytesRead);
    const titleMatch = head.match(/^#\s+(.+)$/m);
    const sessionMatch = head.match(SESSION_MARKER_RE);
    return {
      title: titleMatch ? titleMatch[1].trim() : fallbackTitle,
      sessionId: sessionMatch ? sessionMatch[1] : null,
    };
  } catch {
    return { title: fallbackTitle, sessionId: null };
  }
}

async function scanDir(dir: string, archived: boolean): Promise<PlanInfo[]> {
  const out: PlanInfo[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue; // _archive 디렉토리 등은 스킵
    const p = path.join(dir, entry.name);
    const stat = await fs.stat(p).catch(() => null);
    if (!stat) continue;
    const meta = await readMeta(p, entry.name.replace(/\.md$/, ""));
    out.push({
      filename: entry.name,
      title: meta.title,
      path: p,
      mtime: stat.mtimeMs,
      size: stat.size,
      archived,
      sessionId: meta.sessionId,
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
