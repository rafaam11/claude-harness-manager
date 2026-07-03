import fs from "node:fs/promises";
import path from "node:path";
import { getNews, getNewsBody } from "./news.js";
import { translateItems } from "./translate.js";
import { listFavorites, getFavoriteItem } from "../lib/favorites.js";
import type { ExportResult, ItemTranslation, NewsItem } from "@shared/types";

/**
 * 즐겨찾기(또는 지정 ids)를 각 기사별 .md 파일로 dir에 저장한다.
 *
 * dir은 사용자가 방금 OS 다이얼로그로 고른 폴더(신뢰 앵커)라 guardPath(~/.claude allowlist)를 우회한다 —
 * 대신 파일명을 sanitize하고 join 결과가 dir 밖으로 나가지 않는지 재확인한다(traversal 방어). 본문 fetch·
 * 번역은 main 전용(renderer는 CSP로 외부 호출 불가)이라 export 조립도 여기(main)에 있다.
 */
export async function exportFavoritesMarkdown(dir: string, ids?: string[]): Promise<ExportResult> {
  // 1) 대상 items 해석: ids 있으면 그 기사(피드→즐겨찾기 fallback), 없으면 즐겨찾기 전체.
  let items: NewsItem[];
  if (ids && ids.length) {
    const feed = await getNews();
    const byId = new Map(feed.items.map((i) => [i.id, i] as const));
    items = (
      await Promise.all(ids.map(async (id) => byId.get(id) ?? (await getFavoriteItem(id))))
    ).filter((x): x is NewsItem => Boolean(x));
  } else {
    items = await listFavorites();
  }

  // 2) 번역 배치(한 번). translateItems가 한국어 소스·키 미설정은 자체 처리(빈 맵) → 영어 소스만 번역.
  //    withBody로 claude-code 본문(bodyKo)까지.
  let translations: Record<string, ItemTranslation> = {};
  try {
    translations = (await translateItems(items, { withBody: true })).translations;
  } catch {
    translations = {};
  }

  // 3) 본문 병렬 조회(원문 마크다운). 실패/없음은 buildMarkdown에서 summary로 fallback.
  const bodies = await Promise.all(
    items.map((it) =>
      getNewsBody(it.id)
        .then((r) => r.body)
        .catch(() => null),
    ),
  );

  // 4) 파일 쓰기(항목별 실패는 카운트하고 계속).
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const dirAbs = path.resolve(dir);
  const used = new Set<string>();
  let written = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const name = uniqueName(safeFilename(it), used);
      const target = path.join(dirAbs, name);
      // sanitize로 구분자가 없어야 정상이지만, 만일을 대비해 dir 밖으로 나가면 거부(traversal 방어).
      if (target !== path.resolve(target) || !target.startsWith(dirAbs + path.sep)) {
        throw new Error("경로 이탈 차단");
      }
      const tr = translations[it.id];
      await fs.writeFile(target, buildMarkdown(it, bodies[i], tr?.titleKo, tr?.bodyKo), "utf8");
      written++;
    } catch (e) {
      failed++;
      failures.push(`${it.title}: ${(e as Error).message}`);
    }
  }

  return { dir: dirAbs, written, failed, failures: failures.length ? failures : undefined };
}

/** main엔 renderer의 fmtDate가 없어 재작성(YYYY-MM-DD, UTC). 파일명·frontmatter용. */
function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// 파일명에서 제거할 문자. 제어문자 범위는 소스에 리터럴 제어바이트를 넣지 않도록 문자열+RegExp로 구성한다.
const FN_FORBIDDEN = /[\\/:*?"<>|]/g; // Windows 금지문자 + 경로 구분자
const FN_CONTROL = new RegExp("[\\u0000-\\u001f]", "g"); // 제어문자(0x00–0x1F)

/** Windows/POSIX 안전 파일명. 금지문자·제어문자·traversal 제거, 80자 컷. `${date}_${source}_${title}.md`. */
function safeFilename(item: NewsItem): string {
  const title = item.title
    .replace(FN_FORBIDDEN, "")
    .replace(FN_CONTROL, "")
    .replace(/\.\.+/g, ".") // ".." 축약(traversal)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, ""); // Windows: 끝 점/공백 금지
  const base = `${fmtDate(item.timestamp)}_${item.source}_${title || item.id}`;
  return base.replace(/[\\/]/g, "-") + ".md"; // 잔여 구분자 방어
}

/** 파일명 충돌 시 " (2)", " (3)" suffix. */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** YAML 스칼라 안전 인용(이중따옴표 + 이스케이프는 JSON.stringify로). */
function yaml(v: string): string {
  return JSON.stringify(v);
}

/** 한 기사 마크다운: frontmatter + 제목(+번역제목) + 원문 본문 + (한국어 번역) + 원문 링크. */
function buildMarkdown(
  item: NewsItem,
  body: string | null,
  titleKo?: string,
  bodyKo?: string,
): string {
  const fm = [
    "---",
    `title: ${yaml(item.title)}`,
    titleKo ? `title_ko: ${yaml(titleKo)}` : null,
    `source: ${item.source}`,
    `url: ${yaml(item.url)}`,
    `date: ${fmtDate(item.timestamp)}`,
    item.meta ? `meta: ${yaml(item.meta)}` : null,
    "---",
  ].filter((l): l is string => l !== null);

  const parts: string[] = [fm.join("\n"), "", `# ${item.title}`];
  if (titleKo) parts.push("", `> ${titleKo}`);
  parts.push("", body || item.summary || "_(본문 없음 — 아래 원문 링크 참고)_");
  if (bodyKo) parts.push("", "---", "", "## 한국어 번역", "", bodyKo);
  parts.push("", "---", "", `[원문 열기](${item.url})`);
  return parts.join("\n") + "\n";
}
