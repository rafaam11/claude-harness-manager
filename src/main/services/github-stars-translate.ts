import { DEEPL_MAX_BATCH } from "../config.js";
import { getDeepLKey } from "../lib/secrets.js";
import { maskText, isRestoreValid } from "../lib/mask.js";
import { deeplBatch, splitForBudget, chunk, toTranslateError } from "../lib/deepl-client.js";
import { getGitHubStars, getGitHubReadme } from "./github-stars.js";
import { listGitHubStarsFavorites } from "../lib/github-stars-favorites.js";
import {
  readGitHubStarsTranslationCache,
  mergeGitHubStarsTranslations,
} from "../lib/github-stars-translation-cache.js";
import type { GitHubRepo, GitHubStarsTranslateResponse, RepoTranslation, TranslateReason } from "@shared/types";

/**
 * GitHub Stars 번역 오케스트레이션. services/translate.ts(News)와 같은 구조(캐시 히트 분리 →
 * 미번역만 마스킹 → DeepL 배치 → 복원 → 검증 게이트 → 캐시 머지, 부분 실패도 200)를 따르되
 * fullName 키·번역 대상(설명 + README)만 다르다. DeepL 호출은 lib/deepl-client.ts 공용 클라이언트.
 */

/** 트렌딩/신규 인기 피드에서 못 찾으면 즐겨찾기 스냅샷에서 fallback(News의 피드→즐겨찾기 fallback과 동일 이유). */
async function resolveRepo(fullName: string): Promise<GitHubRepo | null> {
  const feed = await getGitHubStars();
  const found = [...feed.trending, ...feed.newPopular].find((r) => r.fullName === fullName);
  if (found) return found;
  const favorites = await listGitHubStarsFavorites();
  return favorites.find((r) => r.fullName === fullName) ?? null;
}

export async function translateRepos(
  fullNames: string[],
  opts: { withReadme: boolean },
): Promise<GitHubStarsTranslateResponse> {
  const key = await getDeepLKey();
  if (!key) {
    return { translations: {}, reason: "no-key", error: "DeepL 키가 설정되지 않았습니다" };
  }

  const cache = await readGitHubStarsTranslationCache();
  const out: Record<string, RepoTranslation> = {};
  const fresh: Record<string, RepoTranslation & { at: number }> = {};
  let hadFailure = false;
  let stopReason: TranslateReason | undefined;

  // 1) 캐시 히트 분리 → 미번역만 추림(설명은 피드/즐겨찾기 조회, README는 opts.withReadme일 때만)
  const needDescription: { fullName: string; text: string }[] = [];
  const needReadme: { fullName: string; markdown: string }[] = [];
  for (const fullName of fullNames) {
    const c = cache.items[fullName];
    if (c?.descriptionKo) out[fullName] = { ...(out[fullName] ?? {}), descriptionKo: c.descriptionKo };
    if (c?.readmeKo) out[fullName] = { ...(out[fullName] ?? {}), readmeKo: c.readmeKo };

    const needsDescription = !c?.descriptionKo;
    const needsReadme = opts.withReadme && !c?.readmeKo;
    if (!needsDescription && !needsReadme) continue;

    if (needsDescription) {
      const repo = await resolveRepo(fullName);
      if (repo?.description) needDescription.push({ fullName, text: repo.description });
    }
    if (needsReadme) {
      const readme = await getGitHubReadme(fullName);
      if (readme.markdown) needReadme.push({ fullName, markdown: readme.markdown });
    }
  }
  if (needDescription.length === 0 && needReadme.length === 0) {
    return { translations: out }; // 네트워크 0회
  }

  // 2) 설명 배치(≤50). 마스킹 → 번역 → 복원 → 검증
  for (const group of chunk(needDescription, DEEPL_MAX_BATCH)) {
    const masks = group.map((it) => maskText(it.text));
    let translated: string[];
    try {
      translated = await deeplBatch(
        key,
        masks.map((m) => m.masked),
      );
    } catch (e) {
      const te = toTranslateError(e);
      stopReason = te.reason;
      if (Object.keys(fresh).length) await mergeGitHubStarsTranslations(fresh);
      return { translations: out, reason: stopReason, error: te.message };
    }
    group.forEach((it, i) => {
      const m = masks[i];
      const r = m.restore(translated[i] ?? "");
      if (isRestoreValid(m, r) && r.trim()) {
        out[it.fullName] = { ...(out[it.fullName] ?? {}), descriptionKo: r };
        fresh[it.fullName] = { ...(fresh[it.fullName] ?? {}), descriptionKo: r, at: Date.now() };
      } else {
        hadFailure = true; // 원문 폴백, 캐시 안 함
      }
    });
  }

  // 3) README(항목별 — 길이 편차 큼). 마스킹 → 분할 → 배치 → 복원 → 검증
  for (const it of needReadme) {
    const m = maskText(it.markdown);
    const parts = splitForBudget(m.masked);
    const tParts: string[] = [];
    try {
      for (const sub of chunk(parts, DEEPL_MAX_BATCH)) {
        tParts.push(...(await deeplBatch(key, sub)));
      }
    } catch (e) {
      const te = toTranslateError(e);
      stopReason = te.reason;
      hadFailure = true;
      continue; // README 실패는 설명 성공분 보존
    }
    const r = m.restore(tParts.join("\n\n"));
    if (isRestoreValid(m, r) && r.trim()) {
      out[it.fullName] = { ...(out[it.fullName] ?? {}), readmeKo: r };
      fresh[it.fullName] = { ...(fresh[it.fullName] ?? {}), readmeKo: r, at: Date.now() };
    } else {
      hadFailure = true;
    }
  }

  if (Object.keys(fresh).length) await mergeGitHubStarsTranslations(fresh);
  return { translations: out, reason: hadFailure ? (stopReason ?? "partial") : undefined };
}
