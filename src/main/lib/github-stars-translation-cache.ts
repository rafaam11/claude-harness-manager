import fs from "node:fs/promises";
import path from "node:path";
import { GITHUB_STARS_TRANSLATION_CACHE_FILE } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";
import type { RepoTranslation } from "@shared/types";

/**
 * GitHub Stars 번역 캐시(fullName → 번역). News의 translation-cache.ts와 독립 파일 —
 * 리포는 title 개념이 없고 설명/README 중 하나만 있어도 유효해 News의 "titleKo 필수" 셰이프가 안 맞는다.
 * mechanics는 translation-cache.ts와 동일(guardPath + atomic + corrupt 생존, .bak 생략 — 재생성 가능).
 */

interface TranslationEntry {
  descriptionKo?: string;
  readmeKo?: string;
  at: number;
}
export interface GitHubStarsTranslationCacheFile {
  version: 1;
  items: Record<string, TranslationEntry>;
}

function emptyCache(): GitHubStarsTranslationCacheFile {
  return { version: 1, items: {} };
}

/** 신뢰할 수 없는 캐시 파일 내용을 정제 — descriptionKo/readmeKo 둘 다 없는 항목은 버린다. */
function sanitize(parsed: unknown): GitHubStarsTranslationCacheFile {
  const c = emptyCache();
  if (!parsed || typeof parsed !== "object") return c;
  const p = parsed as Record<string, unknown>;
  if (p.items && typeof p.items === "object") {
    for (const [fullName, v] of Object.entries(p.items as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      const e: TranslationEntry = {
        at: typeof r.at === "number" && Number.isFinite(r.at) ? r.at : 0,
      };
      if (typeof r.descriptionKo === "string" && r.descriptionKo) e.descriptionKo = r.descriptionKo;
      if (typeof r.readmeKo === "string" && r.readmeKo) e.readmeKo = r.readmeKo;
      if (e.descriptionKo || e.readmeKo) c.items[fullName] = e;
    }
  }
  return c;
}

export async function readGitHubStarsTranslationCache(): Promise<GitHubStarsTranslationCacheFile> {
  const p = guardPath(GITHUB_STARS_TRANSLATION_CACHE_FILE);
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
      .rename(p, guardPath(`${GITHUB_STARS_TRANSLATION_CACHE_FILE}.corrupt.${stamp}`))
      .catch(() => {});
    return emptyCache();
  }
}

async function writeGitHubStarsTranslationCacheAtomic(
  data: GitHubStarsTranslationCacheFile,
): Promise<void> {
  const p = guardPath(GITHUB_STARS_TRANSLATION_CACHE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tempPath = p + ".chm-tmp";
  await fs.writeFile(tempPath, JSON.stringify(data), "utf8");
  await fs.rename(tempPath, p);
}

/** 부분 번역 결과를 기존 캐시에 머지. descriptionKo/readmeKo는 새 값 우선, 없으면 기존 보존. */
export async function mergeGitHubStarsTranslations(
  patch: Record<string, RepoTranslation & { at?: number }>,
): Promise<void> {
  return withLock(async () => {
    const c = await readGitHubStarsTranslationCache();
    for (const [fullName, e] of Object.entries(patch)) {
      const prev = c.items[fullName] ?? { at: 0 };
      const merged: TranslationEntry = { at: e.at ?? Date.now() };
      const descriptionKo = e.descriptionKo ?? prev.descriptionKo;
      if (descriptionKo) merged.descriptionKo = descriptionKo;
      const readmeKo = e.readmeKo ?? prev.readmeKo;
      if (readmeKo) merged.readmeKo = readmeKo;
      c.items[fullName] = merged;
    }
    await writeGitHubStarsTranslationCacheAtomic(c);
  });
}
