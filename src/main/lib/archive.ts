import fs from "node:fs/promises";
import path from "node:path";
import { ARCHIVE_ROOT, CLAUDE_HOME } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";

export interface ManifestEntry {
  original: string;
  archived: string;
  reason: string;
  movedAt: string;
}

interface JournalEntry extends ManifestEntry {
  done: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function archiveDir(): string {
  return path.join(ARCHIVE_ROOT, today());
}

async function readJsonArray<T>(p: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [data];
  } catch {
    return [];
  }
}

/** manifest는 temp 파일 작성 후 atomic rename으로 갱신 */
async function writeJsonAtomic(p: string, data: unknown) {
  const tmp = p + ".chm-tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, p);
}

async function moveAcrossVolumes(src: string, dest: string) {
  try {
    await fs.rename(src, dest);
  } catch {
    // EXDEV 등 — 복사 후 원본 삭제 (모두 .claude 내부라 보통 같은 볼륨)
    await fs.cp(src, dest, { recursive: true });
    await fs.rm(src, { recursive: true, force: true });
  }
}

/**
 * 항목들을 archive\<오늘>\<category>\ 로 이동하고 manifest에 기록한다.
 * 저널: 이동 전 기록(done=false) → 이동 → done=true 마킹.
 * 중간 실패 시 저널의 done=false 항목으로 어디까지 진행됐는지 추적 가능.
 */
export async function archiveItems(
  items: { path: string; reason: string }[],
  category: string,
): Promise<ManifestEntry[]> {
  return withLock(async () => {
    const base = archiveDir();
    const destDir = path.join(base, category);
    await fs.mkdir(destDir, { recursive: true });

    const manifestPath = path.join(base, "manifest.json");
    const journalPath = path.join(base, "journal.json");
    const manifest = await readJsonArray<ManifestEntry>(manifestPath);
    const journal = await readJsonArray<JournalEntry>(journalPath);
    const results: ManifestEntry[] = [];

    for (const item of items) {
      const src = guardPath(item.path);
      let dest = path.join(destDir, path.basename(src));
      // 같은 이름 충돌 시 상위 디렉토리명을 접두어로
      try {
        await fs.access(dest);
        dest = path.join(destDir, `${path.basename(path.dirname(src))}__${path.basename(src)}`);
      } catch {
        /* 충돌 없음 */
      }

      const entry: JournalEntry = {
        original: src,
        archived: dest,
        reason: item.reason,
        movedAt: new Date().toISOString(),
        done: false,
      };
      journal.push(entry);
      await writeJsonAtomic(journalPath, journal);

      await moveAcrossVolumes(src, dest);

      entry.done = true;
      await writeJsonAtomic(journalPath, journal);

      const { done: _done, ...manifestEntry } = entry;
      manifest.push(manifestEntry);
      await writeJsonAtomic(manifestPath, manifest);
      results.push(manifestEntry);
    }
    return results;
  });
}

/** manifest 항목 단위 복구: archived → original 위치로 되돌리고 manifest에서 제거 */
export async function restoreItem(archivedPath: string): Promise<ManifestEntry> {
  return withLock(async () => {
    const archived = guardPath(archivedPath);

    // 모든 날짜 디렉토리의 manifest에서 검색
    const dates = await fs.readdir(ARCHIVE_ROOT).catch(() => [] as string[]);
    for (const d of dates) {
      const manifestPath = path.join(ARCHIVE_ROOT, d, "manifest.json");
      const manifest = await readJsonArray<ManifestEntry>(manifestPath);
      const idx = manifest.findIndex((e) => path.resolve(e.archived) === archived);
      if (idx === -1) continue;

      const entry = manifest[idx];
      const original = guardPath(entry.original);
      await fs.mkdir(path.dirname(original), { recursive: true });
      await moveAcrossVolumes(archived, original);

      manifest.splice(idx, 1);
      await writeJsonAtomic(manifestPath, manifest);
      return entry;
    }
    throw Object.assign(new Error("manifest에서 해당 항목을 찾을 수 없습니다"), {
      statusCode: 404,
    });
  });
}

/** 전체 manifest 조회 (모든 날짜 통합) */
export async function listManifests() {
  const dates = await fs.readdir(ARCHIVE_ROOT).catch(() => [] as string[]);
  const out: { date: string; entries: ManifestEntry[] }[] = [];
  for (const d of dates.sort().reverse()) {
    const entries = await readJsonArray<ManifestEntry>(
      path.join(ARCHIVE_ROOT, d, "manifest.json"),
    );
    if (entries.length > 0) out.push({ date: d, entries });
  }
  return out;
}

export { CLAUDE_HOME };
