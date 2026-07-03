import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { marked } from "marked";
import { api, fmtDay, fmtTime, fmtRelative } from "../api/client";
import type {
  NewsFeed,
  NewsItem,
  NewsSource,
  ItemTranslation,
  SecretStatus,
  StoredFavorite,
  TranslateResponse,
} from "@shared/types";

type Mode = "en" | "ko" | "both";
const MODE_KEY = "news.lang.mode";

// 소스 배지 라벨(브랜드명이라 언어 무관 동일).
const SOURCE_LABEL: Record<NewsSource, string> = {
  "claude-code": "Claude Code",
  anthropic: "Anthropic",
  geeknews: "GeekNews",
  aitimes: "AI타임스",
  yozm: "요즘IT",
  etnews: "전자신문",
  zdnet: "지디넷코리아",
  irobot: "로봇신문",
  hankyung: "한국경제",
};
const SOURCE_BDG: Record<NewsSource, string> = {
  "claude-code": "bdg-cc",
  anthropic: "bdg-anthropic",
  geeknews: "bdg-geeknews",
  aitimes: "bdg-aitimes",
  yozm: "bdg-yozm",
  etnews: "bdg-etnews",
  zdnet: "bdg-zdnet",
  irobot: "bdg-irobot",
  hankyung: "bdg-hankyung",
};
// 원문이 이미 한국어인 소스 — 번역 요청 자체를 보내지 않는다(main도 이중으로 거른다).
const KOREAN_SOURCES: ReadonlySet<NewsSource> = new Set([
  "geeknews",
  "aitimes",
  "yozm",
  "etnews",
  "zdnet",
  "irobot",
  "hankyung",
]);
// 소스 필터 선택 상태 저장 키(localStorage: 제외된/꺼진 소스 배열 JSON). 기본은 "제외 없음"(전체 표시).
const FILTER_KEY = "news.source.filter";
// "즐겨찾기만 보기" 토글 저장 키(localStorage: "1"/"0").
const FAV_KEY = "news.fav.only";

// News 탭 UI 문구 사전(en/ko). 병기 모드는 한국어 UI를 쓴다.
interface UIText {
  refresh: string;
  refreshing: string;
  lastUpdate: string;
  empty: string;
  openOriginal: string;
  loading: string;
  failed: string;
  translating: string;
  transFail: string;
  keyNeeded: string;
  keyHint: string;
  save: string;
  saving: string;
  favorites: string;
  favEmpty: string;
  bookmark: string;
  bookmarked: string;
  exportBtn: string;
  exporting: string;
  exportTitle: string;
  exportOne: string;
  openFolder: string;
}
const UI: Record<"en" | "ko", UIText> = {
  en: {
    refresh: "Refresh",
    refreshing: "Refreshing…",
    lastUpdate: "Last update:",
    empty: 'No news to show. Try "Refresh".',
    openOriginal: "Open original ↗",
    loading: "Loading…",
    failed: "failed",
    translating: "Translating…",
    transFail: "Translation unavailable — showing original",
    keyNeeded: "Enter a DeepL API key to translate",
    keyHint: "Free key ends with :fx",
    save: "Save",
    saving: "Saving…",
    favorites: "Favorites",
    favEmpty: "No bookmarked news yet. Tap ☆ on an article to save it.",
    bookmark: "Bookmark",
    bookmarked: "Bookmarked",
    exportBtn: "Export",
    exporting: "Exporting…",
    exportTitle: "Export all favorites as .md files",
    exportOne: "Export this article as .md",
    openFolder: "Open folder",
  },
  ko: {
    refresh: "새로고침",
    refreshing: "새로고침 중…",
    lastUpdate: "마지막 갱신:",
    empty: '표시할 뉴스가 없습니다. "새로고침"으로 다시 시도하세요.',
    openOriginal: "원문 열기 ↗",
    loading: "불러오는 중…",
    failed: "실패",
    translating: "번역 중…",
    transFail: "번역을 사용할 수 없어 원문을 표시합니다",
    keyNeeded: "번역하려면 DeepL API 키를 입력하세요",
    keyHint: "무료 키는 :fx 로 끝납니다",
    save: "저장",
    saving: "저장 중…",
    favorites: "즐겨찾기",
    favEmpty: "즐겨찾기한 뉴스가 없습니다. 기사의 ☆를 눌러 저장하세요.",
    bookmark: "즐겨찾기",
    bookmarked: "즐겨찾기됨",
    exportBtn: "내보내기",
    exporting: "내보내는 중…",
    exportTitle: "즐겨찾기 전체를 .md 파일로 내보내기",
    exportOne: "이 기사를 .md로 내보내기",
    openFolder: "폴더 열기",
  },
};

// 세 소스를 시각 역순 병합한 통합 피드 + 언어 전환(English/한국어/병기). 한국어/병기 모드로 볼 때
// main이 DeepL로 미번역 항목만 번역하고(en은 호출 0), 결과는 캐시되어 새로고침해도 carry-over된다.
export default function News() {
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) || "en");
  const [excludedSources, setExcludedSources] = useState<Set<NewsSource>>(() => {
    try {
      const raw = localStorage.getItem(FILTER_KEY);
      return raw ? new Set(JSON.parse(raw) as NewsSource[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [filterOpen, setFilterOpen] = useState(false); // 소스 필터 드롭다운 열림 상태(Timeline 방식)
  // 즐겨찾기: id → 저장된 스냅샷. 마운트 시 서버에서 로드하고 토글은 낙관적 업데이트.
  const [favorites, setFavorites] = useState<Record<string, StoredFavorite>>({});
  const [favOnly, setFavOnly] = useState<boolean>(() => localStorage.getItem(FAV_KEY) === "1");
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ msg: string; dir?: string } | null>(null);
  const [trans, setTrans] = useState<Record<string, ItemTranslation>>({});
  const [transErr, setTransErr] = useState("");
  const [translating, setTranslating] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [images, setImages] = useState<Record<string, string>>({}); // id → 해석된 og:image URL(lazy)
  const [fullBodies, setFullBodies] = useState<Record<string, string>>({}); // id → 원문 전문(마크다운). "" = 추출 실패
  const bodyReq = useRef<Set<string>>(new Set()); // 본문 번역 중복 요청 방지
  const imgReq = useRef<Set<string>>(new Set()); // 이미지 중복 요청 방지
  const fullReq = useRef<Set<string>>(new Set()); // 전문 fetch 중복 요청 방지
  const filterRef = useRef<HTMLDivElement>(null);

  const t = mode === "en" ? UI.en : UI.ko;

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify([...excludedSources]));
  }, [excludedSources]);

  useEffect(() => {
    localStorage.setItem(FAV_KEY, favOnly ? "1" : "0");
  }, [favOnly]);

  const asFavMap = (list: StoredFavorite[]) => Object.fromEntries(list.map((f) => [f.id, f]));

  const toggleSource = (s: NewsSource) =>
    setExcludedSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  // 필터 드롭다운 바깥 클릭 시 닫기(Timeline과 동일 패턴).
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
      .get<NewsFeed>("/api/news")
      .then(setFeed)
      .catch((e) => setError(e.message));
    api
      .get<SecretStatus>("/api/app/secrets/deepl")
      .then((s) => setKeyConfigured(s.configured))
      .catch(() => setKeyConfigured(false));
    api
      .get<StoredFavorite[]>("/api/news/favorites")
      .then((list) => setFavorites(asFavMap(list)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 즐겨찾기 토글(낙관적 → 서버 확정 목록으로 재동기화, 실패 시 GET으로 롤백).
  const toggleFavorite = (it: NewsItem) => {
    const isFav = it.id in favorites;
    setFavorites((prev) => {
      const next = { ...prev };
      if (isFav) delete next[it.id];
      else next[it.id] = { ...it, savedAt: Date.now() };
      return next;
    });
    const req = isFav
      ? api.post<StoredFavorite[]>("/api/news/favorites/remove", { id: it.id })
      : api.post<StoredFavorite[]>("/api/news/favorites", { item: it });
    req
      .then((list) => setFavorites(asFavMap(list)))
      .catch((e) => {
        setError((e as Error).message);
        api
          .get<StoredFavorite[]>("/api/news/favorites")
          .then((list) => setFavorites(asFavMap(list)))
          .catch(() => {});
      });
  };

  // .md export: ids 지정하면 그 기사만(상세 개별), 없으면 즐겨찾기 전체. main이 폴더 dialog+쓰기 수행.
  const runExport = async (ids?: string[]) => {
    if (exporting) return;
    setExporting(true);
    setError("");
    setNotice(null);
    try {
      const res = await window.app.exportFavorites(ids ? { ids } : undefined);
      if (!res) return; // 다이얼로그 취소
      const msg =
        res.failed > 0
          ? `${res.written}개 내보냄 · ${res.failed}개 실패`
          : `${res.written}개 기사를 내보냈습니다`;
      setNotice({ msg, dir: res.dir });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  // 표시 목록: favOnly면 즐겨찾기 스냅샷 ∪ 피드(같은 id는 피드 최신본 우선, timestamp 역순)로 피드에서
  // 빠진 즐겨찾기까지 보여준다. 아니면 기존 피드. 소스 제외 필터는 두 경우 모두 적용.
  const visibleItems = useMemo<NewsItem[]>(() => {
    if (!feed) return [];
    let pool: NewsItem[];
    if (favOnly) {
      const byId = new Map(feed.items.map((i) => [i.id, i] as const));
      pool = Object.values(favorites)
        .map((f) => byId.get(f.id) ?? f)
        .sort((a, b) => b.timestamp - a.timestamp);
    } else {
      pool = feed.items;
    }
    return pool.filter((it) => !excludedSources.has(it.source));
  }, [feed, favOnly, favorites, excludedSources]);

  // 선택 유지/자동선택: 표시 목록 변경 시 현재 선택이 목록에 있으면 유지, 없으면 첫 항목을 자동 선택
  // (읽기용 표면이라 우측 상세가 비어 보이지 않게). 표시할 항목이 없으면 선택 해제.
  useEffect(() => {
    setSelectedId((cur) => {
      if (visibleItems.length === 0) return null;
      if (cur && visibleItems.some((it) => it.id === cur)) return cur;
      return visibleItems[0].id;
    });
  }, [visibleItems]);

  // (A) 목록 제목 일괄 번역: ko/both + 키 설정됨 + 미번역 존재. trans는 의도적 제외(루프 방지).
  // 표시 목록 기준이라 favOnly의 out-of-feed 즐겨찾기 제목도 번역된다(translate 라우트가 favorites fallback).
  useEffect(() => {
    if (mode === "en" || keyConfigured !== true) return;
    const missing = visibleItems
      .filter((i) => !KOREAN_SOURCES.has(i.source) && !trans[i.id]?.titleKo)
      .map((i) => i.id);
    if (missing.length === 0) return;
    setTranslating(true);
    setTransErr("");
    api
      .post<TranslateResponse>("/api/news/translate", { ids: missing, target: "ko", withBody: false })
      .then((r) => {
        setTrans((p) => ({ ...p, ...r.translations }));
        if (r.reason === "no-key") setKeyConfigured(false);
        else if (r.reason && r.error) setTransErr(r.error);
      })
      .catch((e) => setTransErr((e as Error).message))
      .finally(() => setTranslating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, visibleItems, keyConfigured]);

  const ensureBody = (it: NewsItem) => {
    if (mode === "en" || !it.body || keyConfigured !== true) return;
    if (trans[it.id]?.bodyKo || bodyReq.current.has(it.id)) return;
    bodyReq.current.add(it.id);
    api
      .post<TranslateResponse>("/api/news/translate", { ids: [it.id], target: "ko", withBody: true })
      .then((r) => setTrans((p) => ({ ...p, ...r.translations })))
      .catch(() => {})
      .finally(() => bodyReq.current.delete(it.id));
  };

  // 선택 시 원문 전문(마크다운) 보장: claude-code는 이미 body 보유(스킵), 그 외는 원문 페이지에서 1회 lazy-fetch.
  const ensureFullBody = (it: NewsItem) => {
    if (it.body || it.id in fullBodies || fullReq.current.has(it.id)) return;
    fullReq.current.add(it.id);
    api
      .post<{ body: string | null }>("/api/news/body", { id: it.id })
      .then((r) => setFullBodies((p) => ({ ...p, [it.id]: r.body ?? "" })))
      .catch(() => setFullBodies((p) => ({ ...p, [it.id]: "" })))
      .finally(() => fullReq.current.delete(it.id));
  };

  // 펼칠 때 대표 이미지 보장: 인라인(it.image)이 있으면 그대로 쓰고, 없으면 원문 og:image를 1회 lazy-fetch.
  const ensureImage = (it: NewsItem) => {
    if (it.image || images[it.id] || imgReq.current.has(it.id)) return;
    imgReq.current.add(it.id);
    api
      .post<{ image: string | null }>("/api/news/image", { id: it.id })
      .then((r) => {
        if (r.image) setImages((p) => ({ ...p, [it.id]: r.image! }));
      })
      .catch(() => {})
      .finally(() => imgReq.current.delete(it.id));
  };

  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      setFeed(await api.post<NewsFeed>("/api/news/refresh")); // feed 변경 → (A) 재실행으로 신규 항목 번역
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const select = (it: NewsItem) => setSelectedId(it.id);

  const onSavedKey = (ok: boolean) => setKeyConfigured(ok); // true면 (A) effect가 재실행돼 번역 시작

  if (error && !feed) return <div className="banner err">{error}</div>;
  if (!feed) return <div className="muted">{t.loading}</div>;

  // 날짜별 그룹(visibleItems는 이미 시각 역순 정렬됨).
  const groups: { day: string; items: NewsItem[] }[] = [];
  for (const it of visibleItems) {
    const day = fmtDay(it.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }

  const showKeyPanel = mode !== "en" && keyConfigured === false;
  // 선택 항목: 피드 우선, 없으면 즐겨찾기 스냅샷(피드에서 빠진 즐겨찾기 상세가 비지 않게).
  const selected = selectedId
    ? (feed.items.find((it) => it.id === selectedId) ?? favorites[selectedId] ?? null)
    : null;

  return (
    <div className="news-page">
      <h2>News</h2>
      <div className="news-toolbar">
        <button className="update-btn" onClick={refresh} disabled={refreshing}>
          {refreshing ? t.refreshing : t.refresh}
        </button>
        <span className="muted">
          {t.lastUpdate} {feed.lastFetch ? fmtRelative(feed.lastFetch) : "—"}
        </span>
        <div className="news-mode-toggle" role="group" aria-label="language">
          {(["en", "ko", "both"] as Mode[]).map((m) => (
            <button
              key={m}
              className={`mode-btn${mode === m ? " active" : ""}`}
              onClick={() => setMode(m)}
            >
              {m === "en" ? "EN" : m === "ko" ? "한국어" : "EN+한"}
            </button>
          ))}
        </div>
        <button
          className={`news-fav-toggle${favOnly ? " on" : ""}`}
          onClick={() => setFavOnly((v) => !v)}
          title={t.favorites}
        >
          {favOnly ? "★" : "☆"} {t.favorites}
          {Object.keys(favorites).length > 0 && (
            <span className="cat-count">{Object.keys(favorites).length}</span>
          )}
        </button>
        <button
          className="news-export-btn"
          onClick={() => void runExport()}
          disabled={exporting || Object.keys(favorites).length === 0}
          title={t.exportTitle}
        >
          {exporting ? t.exporting : `⬇ ${t.exportBtn}`}
        </button>
        <div className="tl-filter news-filter" ref={filterRef}>
          <button
            className={`tl-filter-btn${filterOpen ? " open" : ""}`}
            onClick={() => setFilterOpen((v) => !v)}
          >
            {mode === "en" ? "Filter" : "필터"}
            {excludedSources.size > 0 && (
              <span className="cat-count">
                {excludedSources.size}
                {mode === "en" ? " hidden" : "개 숨김"}
              </span>
            )}
            {feed.sources.some((s) => !s.ok) && (
              <span className="news-filter-warn" title={t.failed}>
                ⚠ {feed.sources.filter((s) => !s.ok).length}
              </span>
            )}
            <span className="tl-filter-caret">{filterOpen ? "▾" : "▸"}</span>
          </button>
          {filterOpen && (
            <div className="tl-filter-panel">
              <div className="tl-filter-list">
                {feed.sources.map((s) => (
                  <label key={s.source} className="tl-filter-item">
                    <input
                      type="checkbox"
                      checked={!excludedSources.has(s.source)}
                      onChange={() => toggleSource(s.source)}
                    />
                    <span className={`bdg ${SOURCE_BDG[s.source]}`}>{SOURCE_LABEL[s.source]}</span>
                    <span className="tl-filter-name" />
                    <span
                      className={`tl-filter-count ${s.ok ? "muted" : "news-src-err"}`}
                      title={s.ok ? undefined : (s.error ?? t.failed)}
                    >
                      {s.ok ? s.count : t.failed}
                    </span>
                  </label>
                ))}
              </div>
              <div className="tl-filter-actions">
                <button onClick={() => setExcludedSources(new Set())}>
                  {mode === "en" ? "Show all" : "모두 표시"}
                </button>
                <button onClick={() => setExcludedSources(new Set(feed.sources.map((s) => s.source)))}>
                  {mode === "en" ? "Hide all" : "모두 숨기기"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showKeyPanel && <DeepLKeyPanel t={t} onSaved={onSavedKey} />}
      {translating && <div className="muted news-translating-bar">{t.translating}</div>}
      {transErr && <div className="banner warn">{t.transFail}</div>}
      {error && <div className="banner err">{error}</div>}
      {notice && (
        <div className="banner ok news-export-notice">
          <span>✓ {notice.msg}</span>
          {notice.dir && (
            <button className="update-link" onClick={() => void window.app.openPath(notice.dir!)}>
              {t.openFolder}
            </button>
          )}
          {notice.dir && <span className="muted news-export-dir">{notice.dir}</span>}
          <button className="news-notice-x" title="닫기" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="cat-split news-split">
        <div className="ws-master news-master">
          {visibleItems.length === 0 ? (
            <div className="muted cat-master-empty">{favOnly ? t.favEmpty : t.empty}</div>
          ) : (
            groups.map((g) => (
              <div key={g.day}>
                <div className="timeline-day">{g.day}</div>
                {g.items.map((it) => {
                  const fav = it.id in favorites;
                  return (
                    <button
                      key={it.id}
                      className={`cat-master-item${selectedId === it.id ? " active" : ""}`}
                      onClick={() => select(it)}
                    >
                      <div className="cat-mi-head">
                        <span className={`bdg ${SOURCE_BDG[it.source]}`}>
                          {SOURCE_LABEL[it.source]}
                        </span>
                        <span className="cat-mi-name">
                          {titleText(it, mode, trans[it.id]?.titleKo)}
                        </span>
                        {/* 행 전체가 button이라 별표는 span role=button + stopPropagation로 중첩 회피 */}
                        <span
                          role="button"
                          tabIndex={0}
                          className={`news-star${fav ? " on" : ""}`}
                          title={fav ? t.bookmarked : t.bookmark}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(it);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleFavorite(it);
                            }
                          }}
                        >
                          {fav ? "★" : "☆"}
                        </span>
                      </div>
                      <div className="cat-mi-meta">
                        <span>{fmtTime(it.timestamp)}</span>
                        {it.meta && <span>{it.meta}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="ws-detail">
          <div className="ws-detail-inner">
            {selected ? (
              <NewsDetail
                item={selected}
                mode={mode}
                t={t}
                ko={trans[selected.id]}
                image={selected.image ?? images[selected.id]}
                full={fullBodies[selected.id]}
                fetched={selected.id in fullBodies}
                bookmarked={selected.id in favorites}
                onToggleFav={toggleFavorite}
                onExport={(it) => void runExport([it.id])}
                exporting={exporting}
                onNeedBody={ensureBody}
                onNeedImage={ensureImage}
                onNeedFull={ensureFullBody}
              />
            ) : (
              <div className="cat-detail-empty">왼쪽에서 뉴스를 선택하세요.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 제목 노드(모드별): en=원문, ko=번역(없으면 원문), both=원문 + 번역 부제. 마스터/상세가 공유.
function titleText(item: NewsItem, mode: Mode, titleKo?: string): ReactNode {
  if (mode === "en") return item.title;
  if (mode === "ko") return titleKo ?? item.title;
  return (
    <>
      {item.title}
      {titleKo && <span className="title-ko"> · {titleKo}</span>}
    </>
  );
}

/**
 * 상세 패널: claude-code는 body(패치노트) 마크다운을 모드별로 렌더. 그 외 소스는 원문 전문(full, 마크다운)을
 * 우선 렌더(문단·이미지 보존)하고, 아직 없으면 요약 미리보기 + 로딩 표시로 fallback한다.
 */
function NewsDetail({
  item,
  mode,
  t,
  ko,
  image,
  full,
  fetched,
  bookmarked,
  onToggleFav,
  onExport,
  exporting,
  onNeedBody,
  onNeedImage,
  onNeedFull,
}: {
  item: NewsItem;
  mode: Mode;
  t: UIText;
  ko?: ItemTranslation;
  image?: string;
  full?: string; // 원문 전문 마크다운(""=추출 실패, undefined=미조회)
  fetched: boolean; // 전문 fetch 시도 완료 여부
  bookmarked: boolean;
  onToggleFav: (it: NewsItem) => void;
  onExport: (it: NewsItem) => void;
  exporting: boolean;
  onNeedBody: (it: NewsItem) => void;
  onNeedImage: (it: NewsItem) => void;
  onNeedFull: (it: NewsItem) => void;
}) {
  // 선택 시(그리고 모드가 ko/both로 바뀔 때) 본문 번역을 보장.
  useEffect(() => {
    if (mode !== "en" && item.body && !ko?.bodyKo) onNeedBody(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, item.id, ko?.bodyKo]);

  // 선택 시 대표 이미지 보장(인라인 없으면 og:image lazy-fetch).
  useEffect(() => {
    if (!item.image) onNeedImage(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // 선택 시 원문 전문(마크다운) 보장.
  useEffect(() => {
    onNeedFull(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const hasBody = item.source === "claude-code" && !!item.body;
  const html = (md: string) => ({ __html: marked.parse(md) as string });

  return (
    <div className="cat-detail">
      <div className="cat-detail-title">
        <span className={`bdg ${SOURCE_BDG[item.source]}`}>{SOURCE_LABEL[item.source]}</span>
        <span className="cat-detail-name">{titleText(item, mode, ko?.titleKo)}</span>
        <button
          className={`news-star-btn${bookmarked ? " on" : ""}`}
          onClick={() => onToggleFav(item)}
          title={bookmarked ? t.bookmarked : t.bookmark}
        >
          {bookmarked ? "★" : "☆"} {t.bookmark}
        </button>
        <button
          className="news-star-btn news-export-one"
          onClick={() => onExport(item)}
          disabled={exporting}
          title={t.exportOne}
        >
          ⬇ md
        </button>
      </div>
      <div className="cat-detail-meta">
        {new Date(item.timestamp).toLocaleString()}
        {item.meta ? ` · ${item.meta}` : ""}
      </div>
      {/* 전문 마크다운이 있으면 그 안에 본문 이미지가 포함되므로 상단 대표 이미지(hero)는 생략(중복 방지). */}
      {!full && image && (
        <img
          className="news-img"
          src={image}
          alt=""
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      {hasBody ? (
        mode === "en" ? (
          <div className="md-body" dangerouslySetInnerHTML={html(item.body!)} />
        ) : mode === "ko" ? (
          <>
            <div className="md-body" dangerouslySetInnerHTML={html(ko?.bodyKo ?? item.body!)} />
            {!ko?.bodyKo && <p className="muted news-translating">{t.translating}</p>}
          </>
        ) : (
          // both: 원문 + 구분선 + 번역
          <>
            <div className="md-body" dangerouslySetInnerHTML={html(item.body!)} />
            <div className="news-both-sep" />
            {ko?.bodyKo ? (
              <div className="md-body" dangerouslySetInnerHTML={html(ko.bodyKo)} />
            ) : (
              <p className="muted news-translating">{t.translating}</p>
            )}
          </>
        )
      ) : full ? (
        // 원문 전문(마크다운). main의 htmlToMarkdown이 태그를 마크다운 토큰으로만 변환(raw HTML 제거)하므로
        // marked 렌더 대상엔 서드파티 HTML이 남지 않는다. 본문 이미지도 인라인으로 포함된다.
        <div className="md-body" dangerouslySetInnerHTML={html(full)} />
      ) : (
        // 전문 로딩 전/실패: 요약 미리보기(평문) + 조회 중 표시.
        <>
          {item.summary && <p className="news-summary">{item.summary}</p>}
          {!fetched && (
            <p className="muted news-translating">
              {mode === "en" ? "Loading full article…" : "본문 불러오는 중…"}
            </p>
          )}
        </>
      )}
      <button className="update-link" onClick={() => void window.app.openExternal(item.url)}>
        {t.openOriginal}
      </button>
    </div>
  );
}

/** DeepL 키 입력 패널(Catalog 시크릿 마스킹 패턴: password input + 👁/🙈 토글). */
function DeepLKeyPanel({ t, onSaved }: { t: UIText; onSaved: (ok: boolean) => void }) {
  const [val, setVal] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!val.trim()) return;
    setBusy(true);
    try {
      const s = await api.post<SecretStatus>("/api/app/secrets/deepl", { key: val });
      onSaved(s.configured);
      setVal("");
    } catch {
      /* 무시 — 사용자가 다시 시도 */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="banner deepl-key-panel">
      <span className="dk-label">🔑 {t.keyNeeded}</span>
      <input
        className="dk-input mono"
        type={reveal ? "text" : "password"}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="DeepL-Auth-Key (…:fx)"
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      <button className="eye" onClick={() => setReveal((r) => !r)} title="표시/숨기기">
        {reveal ? "🙈" : "👁"}
      </button>
      <button className="update-btn" disabled={busy || !val.trim()} onClick={() => void save()}>
        {busy ? t.saving : t.save}
      </button>
      <span className="muted dk-hint">{t.keyHint}</span>
    </div>
  );
}
