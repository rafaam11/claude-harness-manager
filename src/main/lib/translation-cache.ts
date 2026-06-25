import fs from "node:fs/promises";
import path from "node:path";
import { TRANSLATION_CACHE_FILE } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";
import type { ItemTranslation } from "@shared/types";

/**
 * News 번역 캐시(itemId → 번역). 뉴스 fetch와 독립이라 새로고침으로 items가 바뀌어도
 * id 안정 키로 자동 carry-over된다. 재생성 가능하므로 .bak 백업은 생략(BACKUP_DIR 절약).
 * mechanics는 news-cache.ts/board.ts와 동일(guardPath + atomic + corrupt 생존).
 */

interface TranslationEntry {
  titleKo: string;
  bodyKo?: string;
  at: number;
}
export interface TranslationCacheFile {
  version: 1;
  items: Record<string, TranslationEntry>;
}

function emptyCache(): TranslationCacheFile {
  return { version: 1, items: {} };
}

/** 신뢰할 수 없는 캐시 파일 내용을 정제 — titleKo 없는 항목은 버린다. */
function sanitize(parsed: unknown): TranslationCacheFile {
  const c = emptyCache();
  if (!parsed || typeof parsed !== "object") return c;
  const p = parsed as Record<string, unknown>;
  if (p.items && typeof p.items === "object") {
    for (const [id, v] of Object.entries(p.items as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      if (typeof r.titleKo !== "string" || !r.titleKo) continue;
      const e: TranslationEntry = {
        titleKo: r.titleKo,
        at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
      };
      if (typeof r.bodyKo === "string" && r.bodyKo) e.bodyKo = r.bodyKo;
      c.items[id] = e;
    }
  }
  return c;
}

export async function readTranslationCache(): Promise<TranslationCacheFile> {
  const p = guardPath(TRANSLATION_CACHE_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyCache();
    throw e;
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs
      .rename(p, guardPath(`${TRANSLATION_CACHE_FILE}.corrupt.${stamp}`))
      .catch(() => {});
    return emptyCache();
  }
}

async function writeTranslationCacheAtomic(data: TranslationCacheFile): Promise<void> {
  const p = guardPath(TRANSLATION_CACHE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tempPath = p + ".chm-tmp";
  await fs.writeFile(tempPath, JSON.stringify(data), "utf8");
  await fs.rename(tempPath, p);
}

/** 부분 번역 결과를 기존 캐시에 머지. titleKo/bodyKo는 새 값 우선, 없으면 기존 보존. */
export async function mergeTranslations(
  patch: Record<string, ItemTranslation & { at?: number }>,
): Promise<void> {
  return withLock(async () => {
    const c = await readTranslationCache();
    for (const [id, e] of Object.entries(patch)) {
      const prev = c.items[id] ?? { titleKo: "", at: 0 };
      const merged: TranslationEntry = {
        titleKo: e.titleKo || prev.titleKo,
        at: e.at ?? Date.now(),
      };
      const bodyKo = e.bodyKo ?? prev.bodyKo;
      if (bodyKo) merged.bodyKo = bodyKo;
      c.items[id] = merged;
    }
    await writeTranslationCacheAtomic(c);
  });
}
