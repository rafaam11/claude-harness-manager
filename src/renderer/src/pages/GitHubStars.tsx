import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, fmtStars, fmtClock, fmtRelative } from "../api/client";
import type {
  GitHubRepo,
  GitHubStarsFeed,
  GitHubReadme,
  GitHubStarsTranslateResponse,
  ItemStateMap,
  RepoTranslation,
  StoredGitHubRepo,
} from "@shared/types";
import type { Mode } from "./News";

// News 탭의 GitHub Stars 서브섹션. news.ts/News.tsx의 검증된 패턴(fetch-with-timeout, graceful
// degradation, 필터 드롭다운, 마스터-디테일 2단, 즐겨찾기)을 그대로 재사용한다. 트렌딩/신규 인기는
// 병합하지 않고 서브탭으로 분리 — 한쪽이 스크래핑 실패해도 다른 쪽은 정상 표시된다.

const LANG_FILTER_KEY = "news.gh.langFilter";
const TAB_KEY = "news.gh.tab";
type Tab = "trending" | "new-popular" | "favorites" | "hidden";

// --- README 렌더링 전용 XSS 하드닝 + 상대 경로 해석 ---
// GitHub README는 제3자가 자유롭게 쓰는 신뢰할 수 없는 마크다운 소스라 raw HTML을 포함할 수 있다
// (배지 정렬용 <p align>, 다크/라이트 로고 전환용 <picture>, <details> 등 — News의 htmlToMarkdown 같은
// raw-HTML 제거 전처리가 없음). 이전엔 raw HTML을 전부 이스케이프해 "보이는 텍스트"로만 남겼는데,
// 이런 태그를 쓰는 README에서 태그가 그대로 노출되는 문제가 있었다. marked가 만든 HTML을
// DOMPurify로 한 번 더 걸러 스크립트/이벤트 핸들러/위험 URL 스킴만 제거하고 일반 서식 태그는
// 그대로 렌더링한다(직접 짠 정규식 기반 allowlist보다 검증된 라이브러리가 더 안전하다는 판단).
//
// README 원문의 이미지/동영상/링크 경로는 리포 루트가 아니라 README 파일 자신을 기준으로 한
// 상대 경로("assets/demo.gif", "./docs/x.png")인 경우가 많다 — 우리 앱 origin 기준으로는 당연히
// 깨진다(GitHub 웹은 이걸 raw.githubusercontent.com/blob URL 기준으로 풀어서 보여준다). 그래서
// media(src)는 README raw 파일 URL(downloadUrl), 링크(href)는 GitHub blob URL(htmlUrl)을 기준으로
// new URL(상대경로, 기준)로 절대화한다 — 이미 절대 URL이면 base는 무시되므로 그대로 통과한다.
const MEDIA_SRC_TAGS = new Set(["IMG", "SOURCE", "VIDEO", "AUDIO", "TRACK"]);

function resolveUrl(base: string | undefined, url: string): string {
  if (!base) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

// DOMPurify 훅은 누적되므로(호출마다 addHook하면 계속 쌓임) 전역에 한 번만 등록하고, 현재 README의
// 기준 URL은 sanitize() 호출 직전에 이 변수로 넘긴다 — sanitize()가 동기 실행이라 레이스가 없다.
let currentBases: { htmlUrl?: string; downloadUrl?: string } = {};

let readmeHooksInstalled = false;
function ensureReadmeSanitizerHooks() {
  if (readmeHooksInstalled) return;
  readmeHooksInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href");
      if (href) node.setAttribute("href", resolveUrl(currentBases.htmlUrl, href));
      // 외부 링크는 항상 새 창 + noopener로(README 원문이 target/rel을 지정하지 않아도 강제).
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noreferrer noopener");
    } else if (MEDIA_SRC_TAGS.has(node.tagName)) {
      const src = node.getAttribute("src");
      if (src) node.setAttribute("src", resolveUrl(currentBases.downloadUrl, src));
    }
  });
}
ensureReadmeSanitizerHooks();

function renderReadme(markdown: string, htmlUrl?: string, downloadUrl?: string): string {
  currentBases = { htmlUrl, downloadUrl };
  const html = DOMPurify.sanitize(marked.parse(markdown) as string);
  currentBases = {};
  return html;
}

const asFavMap = (list: StoredGitHubRepo[]) => Object.fromEntries(list.map((r) => [r.id, r]));

// 숨김 토글 아이콘(눈모양 흑백 SVG). News.tsx와 완전 독립 원칙에 따라 동일 모양을 이 파일에도 복제.
// off=true(숨겨진 항목/숨김 탭)는 슬래시를 그어 "숨겨짐"을 표현.
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      className="eye-icon"
      viewBox="0 0 20 20"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M1 10s3.2-5.5 9-5.5S19 10 19 10s-3.2 5.5-9 5.5S1 10 1 10Z" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.4" />
      {off && <line x1="2" y1="18" x2="18" y2="2" strokeLinecap="round" />}
    </svg>
  );
}

export default function GitHubStars({
  mode,
  keyConfigured,
  onKeyMissing,
}: {
  mode: Mode;
  keyConfigured: boolean | null;
  onKeyMissing: () => void;
}) {
  const [feed, setFeed] = useState<GitHubStarsFeed | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem(TAB_KEY) as Tab) || "trending");
  const [excludedLangs, setExcludedLangs] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LANG_FILTER_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Record<string, StoredGitHubRepo>>({});
  const [readmes, setReadmes] = useState<Record<string, GitHubReadme>>({});
  const readmeReq = useRef<Set<string>>(new Set());
  const [transRepo, setTransRepo] = useState<Record<string, RepoTranslation>>({});
  const [translating, setTranslating] = useState(false);
  const [transErr, setTransErr] = useState("");
  const readmeTransReq = useRef<Set<string>>(new Set());
  // 읽음 시각/숨김 상태: fullName → { lastReadAt?, hidden? }. News.tsx와 동일 패턴, 별도 store.
  const [itemState, setItemState] = useState<ItemStateMap>({});
  // 숨김 보류: 클릭 즉시 목록에서 지우지 않고, 다른 항목으로 선택이 바뀔 때 실제로 커밋한다(실수 클릭 방지).
  // News.tsx와 완전 독립 원칙에 따라 동일 로직을 이 파일에도 복제(키는 fullName).
  const [pendingHide, setPendingHide] = useState<Set<string>>(new Set());
  const pendingHideRef = useRef<Set<string>>(pendingHide);

  useEffect(() => {
    localStorage.setItem(TAB_KEY, tab);
  }, [tab]);

  useEffect(() => {
    localStorage.setItem(LANG_FILTER_KEY, JSON.stringify([...excludedLangs]));
  }, [excludedLangs]);

  useEffect(() => {
    pendingHideRef.current = pendingHide;
  }, [pendingHide]);

  // 필터 드롭다운 바깥 클릭 시 닫기(News.tsx와 동일 패턴).
  useEffect(() => {
    if (!filterOpen) return;
    const onClick = (ev: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(ev.target as Node)) setFilterOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [filterOpen]);

  useEffect(() => {
    api
      .get<GitHubStarsFeed>("/api/github-stars")
      .then(setFeed)
      .catch((e) => setError(e.message));
    api
      .get<StoredGitHubRepo[]>("/api/github-stars/favorites")
      .then((list) => setFavorites(asFavMap(list)))
      .catch(() => {});
    api
      .get<ItemStateMap>("/api/github-stars/item-state")
      .then(setItemState)
      .catch(() => {});
  }, []);

  // 읽음 마킹: 상세가 열릴 때(자동 선택된 첫 항목 포함) 호출. 서버가 돌려준 전체 맵으로 재동기화.
  const markRead = (fullName: string) => {
    api
      .post<ItemStateMap>("/api/github-stars/item-state/read", { fullName })
      .then(setItemState)
      .catch(() => {});
  };

  // 숨김 토글: 낙관적 업데이트 후 서버 확정 맵으로 재동기화(실패해도 다음 로드에서 맞춰짐).
  const toggleHidden = (fullName: string, hidden: boolean) => {
    setItemState((prev) => ({
      ...prev,
      [fullName]: { ...prev[fullName], hidden: hidden || undefined },
    }));
    api
      .post<ItemStateMap>("/api/github-stars/item-state/hide", { fullName, hidden })
      .then(setItemState)
      .catch(() => {});
  };

  // 숨김 버튼 클릭: 이미 확정 숨김이면 즉시 반영(해제), 아니면 목록에서 바로 지우지 않고 보류만
  // 건다 — 다른 항목으로 이동할 때 커밋 effect가 실제로 숨긴다(실수 클릭 방지).
  const onHideClick = (fullName: string, committedHidden: boolean) => {
    if (committedHidden) {
      toggleHidden(fullName, false);
      return;
    }
    setPendingHide((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  };

  // 선택이 다른 리포지토리로 바뀌면 그 사이 보류 중이던 숨김을 실제로 확정한다.
  useEffect(() => {
    const names = pendingHideRef.current;
    if (names.size === 0) return;
    setPendingHide(new Set());
    names.forEach((fullName) => toggleHidden(fullName, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      setFeed(await api.post<GitHubStarsFeed>("/api/github-stars/refresh"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  // 즐겨찾기 토글(낙관적 → 서버 확정 목록으로 재동기화, 실패 시 GET으로 롤백). News.tsx와 동일 패턴.
  const toggleFavorite = (r: GitHubRepo) => {
    const isFav = r.id in favorites;
    setFavorites((prev) => {
      const next = { ...prev };
      if (isFav) delete next[r.id];
      else next[r.id] = { ...r, savedAt: Date.now() };
      return next;
    });
    const req = isFav
      ? api.post<StoredGitHubRepo[]>("/api/github-stars/favorites/remove", { id: r.id })
      : api.post<StoredGitHubRepo[]>("/api/github-stars/favorites", { repo: r });
    req
      .then((list) => setFavorites(asFavMap(list)))
      .catch((e) => {
        setError((e as Error).message);
        api
          .get<StoredGitHubRepo[]>("/api/github-stars/favorites")
          .then((list) => setFavorites(asFavMap(list)))
          .catch(() => {});
      });
  };

  const toggleLang = (lang: string) =>
    setExcludedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });

  const languages = useMemo(() => {
    if (!feed) return [];
    const set = new Set<string>();
    for (const r of [...feed.trending, ...feed.newPopular]) if (r.language) set.add(r.language);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [feed]);

  // 탭별 표시 목록: 즐겨찾기 탭은 저장된 스냅샷(savedAt 역순), hidden 탭은 전체(트렌딩+신규인기+즐겨찾기)
  // 중 숨긴 것만, 그 외는 피드 그룹 + 언어 제외 필터. 숨김은 hidden 탭을 제외한 모든 뷰에서 일관 제외.
  const visibleRepos = useMemo<GitHubRepo[]>(() => {
    if (tab === "hidden") {
      const byFullName = new Map<string, GitHubRepo>();
      for (const r of [...(feed?.trending ?? []), ...(feed?.newPopular ?? []), ...Object.values(favorites)]) {
        byFullName.set(r.fullName, r);
      }
      return [...byFullName.values()].filter((r) => itemState[r.fullName]?.hidden);
    }
    if (tab === "favorites") {
      return Object.values(favorites)
        .sort((a, b) => b.savedAt - a.savedAt)
        .filter((r) => !itemState[r.fullName]?.hidden);
    }
    if (!feed) return [];
    const list = tab === "trending" ? feed.trending : feed.newPopular;
    return list.filter(
      (r) => (!r.language || !excludedLangs.has(r.language)) && !itemState[r.fullName]?.hidden,
    );
  }, [tab, feed, favorites, excludedLangs, itemState]);

  // 선택 유지/자동선택: 탭 전환·목록 변경 시 현재 선택이 목록에 있으면 유지, 없으면 첫 항목 자동 선택.
  useEffect(() => {
    setSelectedId((cur) => {
      if (visibleRepos.length === 0) return null;
      if (cur && visibleRepos.some((r) => r.id === cur)) return cur;
      return visibleRepos[0].id;
    });
  }, [visibleRepos]);

  // 설명 일괄 번역: News.tsx (A) 효과와 동일 패턴(키는 fullName). transRepo는 의도적으로 deps 제외(루프 방지).
  useEffect(() => {
    if (mode === "en" || keyConfigured !== true) return;
    const missing = [
      ...new Set(
        visibleRepos
          .filter((r) => r.description && !transRepo[r.fullName]?.descriptionKo)
          .map((r) => r.fullName),
      ),
    ];
    if (missing.length === 0) return;
    setTranslating(true);
    setTransErr("");
    api
      .post<GitHubStarsTranslateResponse>("/api/github-stars/translate", { fullNames: missing })
      .then((r) => {
        setTransRepo((p) => ({ ...p, ...r.translations }));
        if (r.reason === "no-key") onKeyMissing();
        else if (r.reason && r.error) setTransErr(r.error);
      })
      .catch((e) => setTransErr((e as Error).message))
      .finally(() => setTranslating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, visibleRepos, keyConfigured]);

  const ensureReadme = (fullName: string) => {
    if (fullName in readmes || readmeReq.current.has(fullName)) return;
    readmeReq.current.add(fullName);
    api
      .post<GitHubReadme>("/api/github-stars/readme", { fullName })
      .then((r) => setReadmes((p) => ({ ...p, [fullName]: r })))
      .catch((e) => setReadmes((p) => ({ ...p, [fullName]: { markdown: null, error: (e as Error).message } })))
      .finally(() => readmeReq.current.delete(fullName));
  };

  const ensureReadmeTranslation = (fullName: string) => {
    if (mode === "en" || keyConfigured !== true) return;
    if (transRepo[fullName]?.readmeKo || readmeTransReq.current.has(fullName)) return;
    readmeTransReq.current.add(fullName);
    api
      .post<GitHubStarsTranslateResponse>("/api/github-stars/translate", {
        fullNames: [fullName],
        withReadme: true,
      })
      .then((r) => setTransRepo((p) => ({ ...p, ...r.translations })))
      .catch(() => {})
      .finally(() => readmeTransReq.current.delete(fullName));
  };

  const selected = selectedId ? (visibleRepos.find((r) => r.id === selectedId) ?? null) : null;
  const selectedIndex = selectedId ? visibleRepos.findIndex((r) => r.id === selectedId) : -1;
  const hiddenCount = Object.values(itemState).filter((s) => s.hidden).length;

  // 순차 탐색: 현재 필터된 목록(visibleRepos) 기준 상대 이동. 범위 밖이면 no-op.
  const selectByOffset = (offset: number) => {
    const idx = visibleRepos.findIndex((r) => r.id === selectedId);
    if (idx < 0) return;
    const next = visibleRepos[idx + offset];
    if (next) setSelectedId(next.id);
  };

  const groupStatus =
    tab === "trending"
      ? feed?.groups.find((g) => g.group === "trending")
      : tab === "new-popular"
        ? feed?.groups.find((g) => g.group === "new-popular")
        : undefined;
  const favCount = Object.keys(favorites).length;

  return (
    <>
      <div className="news-mode-toggle" role="group" aria-label="github-stars-tab">
        <button
          className={`mode-btn${tab === "trending" ? " active" : ""}`}
          onClick={() => setTab("trending")}
        >
          🔥 트렌딩
        </button>
        <button
          className={`mode-btn${tab === "new-popular" ? " active" : ""}`}
          onClick={() => setTab("new-popular")}
        >
          🌱 신규 인기
        </button>
        <button
          className={`mode-btn${tab === "favorites" ? " active" : ""}`}
          onClick={() => setTab("favorites")}
        >
          ⭐ 즐겨찾기
          {favCount > 0 && <span className="cat-count">{favCount}</span>}
        </button>
        <button
          className={`mode-btn${tab === "hidden" ? " active" : ""}`}
          onClick={() => setTab("hidden")}
        >
          <EyeIcon off /> 숨김
          {hiddenCount > 0 && <span className="cat-count">{hiddenCount}</span>}
        </button>
      </div>

      {tab !== "favorites" && tab !== "hidden" && (
        <div className="news-toolbar">
          <button className="update-btn" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "새로고침 중…" : "새로고침"}
          </button>
          <span className="muted">
            마지막 갱신: {feed?.lastFetch ? fmtRelative(feed.lastFetch) : "—"}
          </span>
          <div className="tl-filter news-filter" ref={filterRef}>
            <button
              className={`tl-filter-btn${filterOpen ? " open" : ""}`}
              onClick={() => setFilterOpen((v) => !v)}
            >
              언어
              {excludedLangs.size > 0 && <span className="cat-count">{excludedLangs.size}개 숨김</span>}
              {groupStatus && !groupStatus.ok && (
                <span className="news-filter-warn" title={groupStatus.error ?? "실패"}>
                  ⚠
                </span>
              )}
              <span className="tl-filter-caret">{filterOpen ? "▾" : "▸"}</span>
            </button>
            {filterOpen && (
              <div className="tl-filter-panel">
                <div className="tl-filter-list">
                  {languages.length === 0 && <div className="muted">언어 정보 없음</div>}
                  {languages.map((lang) => (
                    <label key={lang} className="tl-filter-item">
                      <input
                        type="checkbox"
                        checked={!excludedLangs.has(lang)}
                        onChange={() => toggleLang(lang)}
                      />
                      <span className="tl-filter-name">{lang}</span>
                    </label>
                  ))}
                </div>
                <div className="tl-filter-actions">
                  <button onClick={() => setExcludedLangs(new Set())}>모두 표시</button>
                  <button onClick={() => setExcludedLangs(new Set(languages))}>모두 숨기기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {translating && <div className="muted news-translating-bar">번역 중…</div>}
      {transErr && <div className="banner warn">번역을 사용할 수 없어 원문을 표시합니다</div>}
      {error && <div className="banner err">{error}</div>}

      {!feed && tab !== "favorites" && tab !== "hidden" ? (
        <div className="muted">불러오는 중…</div>
      ) : (
        <div className="cat-split gh-stars-split">
          <div className="ws-master">
            {groupStatus && !groupStatus.ok && (
              <div className="banner warn">
                이 그룹을 가져오지 못했습니다{groupStatus.error ? `: ${groupStatus.error}` : ""}
              </div>
            )}
            {visibleRepos.length === 0 ? (
              <div className="muted cat-master-empty">
                {tab === "hidden"
                  ? "숨긴 리포지토리가 없습니다."
                  : tab === "favorites"
                    ? "즐겨찾기한 리포지토리가 없습니다. ☆를 눌러 저장하세요."
                    : "표시할 리포지토리가 없습니다."}
              </div>
            ) : (
              visibleRepos.map((r) => {
                const fav = r.id in favorites;
                const state = itemState[r.fullName];
                const committed = Boolean(state?.hidden);
                const pending = pendingHide.has(r.fullName);
                const hideActive = committed || pending;
                return (
                  <button
                    key={r.id}
                    className={`cat-master-item${selectedId === r.id ? " active" : ""}${state?.lastReadAt ? " is-read" : ""}`}
                    onClick={() => setSelectedId(r.id)}
                  >
                    <div className="cat-mi-head">
                      {r.ownerAvatar && <img className="gh-stars-avatar" src={r.ownerAvatar} alt="" />}
                      <span className="cat-mi-name">{r.fullName}</span>
                      {r.language && <span className="t-tag">{r.language}</span>}
                      {/* 행 전체가 button이라 별표/숨김은 span role=button + stopPropagation로 중첩 회피 */}
                      <span className="cat-mi-actions">
                        <span
                          role="button"
                          tabIndex={0}
                          className={`news-hide-btn${hideActive ? " on" : ""}`}
                          title={committed ? "숨김 해제" : pending ? "숨김 취소" : "숨기기"}
                          onClick={(e) => {
                            e.stopPropagation();
                            onHideClick(r.fullName, committed);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onHideClick(r.fullName, committed);
                            }
                          }}
                        >
                          <EyeIcon off={hideActive} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className={`news-star${fav ? " on" : ""}`}
                          title={fav ? "즐겨찾기됨" : "즐겨찾기"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(r);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleFavorite(r);
                            }
                          }}
                        >
                          {fav ? "★" : "☆"}
                        </span>
                      </span>
                    </div>
                    <div className="cat-mi-meta">
                      <span>⭐ {fmtStars(r.stars)}</span>
                      {typeof r.starsToday === "number" && <span>+{fmtStars(r.starsToday)} today</span>}
                      {r.description && (
                        <span>{descText(r, mode, transRepo[r.fullName]?.descriptionKo)}</span>
                      )}
                      {state?.lastReadAt && (
                        <span className="t-tag" title={new Date(state.lastReadAt).toLocaleString()}>
                          ✓ {fmtClock(state.lastReadAt)}
                        </span>
                      )}
                      {pending && <span className="t-tag pending-tag">숨김 예정</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="ws-detail">
            <div className="ws-detail-inner">
              {selected ? (
                <RepoDetail
                  repo={selected}
                  mode={mode}
                  trans={transRepo[selected.fullName]}
                  bookmarked={selected.id in favorites}
                  onToggleFav={toggleFavorite}
                  readme={readmes[selected.fullName]}
                  onNeedReadme={ensureReadme}
                  onNeedReadmeTranslation={ensureReadmeTranslation}
                  hidden={Boolean(itemState[selected.fullName]?.hidden)}
                  pending={pendingHide.has(selected.fullName)}
                  onToggleHidden={onHideClick}
                  lastReadAt={itemState[selected.fullName]?.lastReadAt}
                  onRead={markRead}
                  hasPrev={selectedIndex > 0}
                  hasNext={selectedIndex >= 0 && selectedIndex < visibleRepos.length - 1}
                  onPrev={() => selectByOffset(-1)}
                  onNext={() => selectByOffset(1)}
                  position={
                    selectedIndex >= 0
                      ? { index: selectedIndex + 1, total: visibleRepos.length }
                      : null
                  }
                />
              ) : (
                <div className="cat-detail-empty">왼쪽에서 리포지토리를 선택하세요.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// 설명 노드(모드별): en=원문, ko=번역(없으면 원문), both=원문 + 번역 부제. News.tsx의 titleText와 동일 패턴.
function descText(repo: GitHubRepo, mode: Mode, descriptionKo?: string): ReactNode {
  if (mode === "en") return repo.description;
  if (mode === "ko") return descriptionKo ?? repo.description;
  return (
    <>
      {repo.description}
      {descriptionKo && <span className="title-ko"> · {descriptionKo}</span>}
    </>
  );
}

function RepoDetail({
  repo,
  mode,
  trans,
  bookmarked,
  onToggleFav,
  readme,
  onNeedReadme,
  onNeedReadmeTranslation,
  hidden,
  pending,
  onToggleHidden,
  lastReadAt,
  onRead,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  position,
}: {
  repo: GitHubRepo;
  mode: Mode;
  trans?: RepoTranslation;
  bookmarked: boolean;
  onToggleFav: (r: GitHubRepo) => void;
  readme?: GitHubReadme;
  onNeedReadme: (fullName: string) => void;
  onNeedReadmeTranslation: (fullName: string) => void;
  hidden: boolean;
  pending: boolean; // 숨김 보류 중(아직 커밋 전) — 다른 항목으로 이동하면 실제로 숨겨진다.
  onToggleHidden: (fullName: string, committedHidden: boolean) => void;
  lastReadAt?: number;
  onRead: (fullName: string) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  position: { index: number; total: number } | null;
}) {
  useEffect(() => {
    onNeedReadme(repo.fullName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.fullName]);

  // README 로드 완료 + ko/both 모드면 번역 보장(News.tsx의 onNeedBody와 동일 위치).
  useEffect(() => {
    if (mode !== "en" && readme?.markdown && !trans?.readmeKo) onNeedReadmeTranslation(repo.fullName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, repo.fullName, readme?.markdown, trans?.readmeKo]);

  // 선택 시(자동 선택된 첫 항목 포함) 읽음으로 마킹.
  useEffect(() => {
    onRead(repo.fullName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.fullName]);

  return (
    <div className="cat-detail">
      {position && (
        <div className="cat-detail-nav">
          <button className="cat-nav-btn" onClick={onPrev} disabled={!hasPrev}>
            ‹ 이전
          </button>
          <span className="muted">
            {position.index} / {position.total}
          </span>
          <button className="cat-nav-btn" onClick={onNext} disabled={!hasNext}>
            다음 ›
          </button>
        </div>
      )}
      <div className="cat-detail-title">
        {repo.ownerAvatar && <img className="gh-stars-avatar" src={repo.ownerAvatar} alt="" />}
        <span className="cat-detail-name">{repo.fullName}</span>
        {repo.language && <span className="t-tag">{repo.language}</span>}
        <div className="cat-detail-actions">
          <button
            className={`news-star-btn${bookmarked ? " on" : ""}`}
            onClick={() => onToggleFav(repo)}
            title={bookmarked ? "즐겨찾기됨" : "즐겨찾기"}
          >
            {bookmarked ? "★" : "☆"} 즐겨찾기
          </button>
          <button
            className={`news-star-btn${hidden || pending ? " on" : ""}`}
            onClick={() => onToggleHidden(repo.fullName, hidden)}
            title={hidden ? "숨김 해제" : pending ? "숨김 취소" : "숨기기"}
          >
            <EyeIcon off={hidden || pending} /> {hidden ? "숨김 해제" : pending ? "숨김 취소" : "숨기기"}
          </button>
        </div>
      </div>
      <div className="cat-detail-meta">
        ⭐ {fmtStars(repo.stars)}
        {typeof repo.starsToday === "number" ? ` · +${fmtStars(repo.starsToday)} today` : ""}
        {typeof repo.createdAt === "number"
          ? ` · ${new Date(repo.createdAt).toLocaleDateString()} 생성`
          : ""}
        {lastReadAt ? ` · 마지막 읽음: ${new Date(lastReadAt).toLocaleString()}` : ""}
        {pending ? " · 숨김 예정" : ""}
      </div>
      {repo.description && (
        <p className="news-summary">{descText(repo, mode, trans?.descriptionKo)}</p>
      )}
      {!readme ? (
        <p className="muted news-translating">README 불러오는 중…</p>
      ) : readme.error ? (
        <p className="muted news-translating">README를 불러오지 못했습니다: {readme.error}</p>
      ) : readme.markdown == null ? (
        <p className="muted news-translating">README가 없습니다.</p>
      ) : mode === "en" ? (
        <div
          className="md-body"
          dangerouslySetInnerHTML={{
            __html: renderReadme(readme.markdown, readme.htmlUrl, readme.downloadUrl),
          }}
        />
      ) : mode === "ko" ? (
        <>
          <div
            className="md-body"
            dangerouslySetInnerHTML={{
              __html: renderReadme(trans?.readmeKo ?? readme.markdown, readme.htmlUrl, readme.downloadUrl),
            }}
          />
          {!trans?.readmeKo && <p className="muted news-translating">번역 중…</p>}
        </>
      ) : (
        // both: 원문 + 구분선 + 번역
        <>
          <div
            className="md-body"
            dangerouslySetInnerHTML={{
              __html: renderReadme(readme.markdown, readme.htmlUrl, readme.downloadUrl),
            }}
          />
          <div className="news-both-sep" />
          {trans?.readmeKo ? (
            <div
              className="md-body"
              dangerouslySetInnerHTML={{
                __html: renderReadme(trans.readmeKo, readme.htmlUrl, readme.downloadUrl),
              }}
            />
          ) : (
            <p className="muted news-translating">번역 중…</p>
          )}
        </>
      )}
      <button className="update-link" onClick={() => void window.app.openExternal(repo.url)}>
        GitHub에서 보기 ↗
      </button>
    </div>
  );
}
