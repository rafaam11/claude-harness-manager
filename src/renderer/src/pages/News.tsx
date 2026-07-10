import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, fmtDay, fmtTime, fmtClock, fmtRelative } from "../api/client";
import { renderMarkdownSafe } from "../markdown";
import GitHubStars from "./GitHubStars";
import type {
  NewsFeed,
  NewsItem,
  NewsSource,
  ItemTranslation,
  ItemStateMap,
  SecretStatus,
  StoredFavorite,
  TranslateResponse,
} from "@shared/types";

export type Mode = "en" | "ko" | "both";
const MODE_KEY = "news.lang.mode";
// 기사/GitHub Stars 세그먼트 선택 저장 키(localStorage). 통합 타임라인에 섞지 않고 완전히 별도 화면 전환.
type Segment = "articles" | "github-stars";
const SEGMENT_KEY = "news.segment";

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
  hiddenView: string;
  hiddenEmpty: string;
  hideBtn: string;
  unhideBtn: string;
  cancelHide: string;
  pendingHideTag: string;
  lastRead: string;
  prevBtn: string;
  nextBtn: string;
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
    hiddenView: "Hidden",
    hiddenEmpty: "No hidden articles.",
    hideBtn: "Hide",
    unhideBtn: "Unhide",
    cancelHide: "Cancel hide",
    pendingHideTag: "Will hide on next",
    lastRead: "Last read:",
    prevBtn: "‹ Prev",
    nextBtn: "Next ›",
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
    hiddenView: "숨김",
    hiddenEmpty: "숨긴 기사가 없습니다.",
    hideBtn: "숨기기",
    unhideBtn: "숨김 해제",
    cancelHide: "숨김 취소",
    pendingHideTag: "숨김 예정",
    lastRead: "마지막 읽음:",
    prevBtn: "‹ 이전",
    nextBtn: "다음 ›",
  },
};

// 세 소스를 시각 역순 병합한 통합 피드 + 언어 전환(English/한국어/병기). 한국어/병기 모드로 볼 때
// main이 DeepL로 미번역 항목만 번역하고(en은 호출 0), 결과는 캐시되어 새로고침해도 carry-over된다.
export default function News() {
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [segment, setSegment] = useState<Segment>(
    () => (localStorage.getItem(SEGMENT_KEY) as Segment) || "articles",
  );
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
  // 읽음 시각/숨김 상태: id → { lastReadAt?, hidden? }. 마운트 시 서버에서 로드, 이후 read/hide 응답으로 재동기화.
  const [itemState, setItemState] = useState<ItemStateMap>({});
  const [hiddenView, setHiddenView] = useState(false); // "숨김 보기" 토글(비영속 — filterOpen과 동일).
  // 숨김 보류: 클릭 즉시 목록에서 지우지 않고, 다른 항목으로 선택이 바뀔 때 실제로 커밋한다(실수 클릭 방지).
  const [pendingHide, setPendingHide] = useState<Set<string>>(new Set());
  const pendingHideRef = useRef<Set<string>>(pendingHide); // 커밋 effect가 selectedId 변경 시점의 최신값을 읽기 위함
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
    localStorage.setItem(SEGMENT_KEY, segment);
  }, [segment]);

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify([...excludedSources]));
  }, [excludedSources]);

  useEffect(() => {
    localStorage.setItem(FAV_KEY, favOnly ? "1" : "0");
  }, [favOnly]);

  useEffect(() => {
    pendingHideRef.current = pendingHide;
  }, [pendingHide]);

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
    api
      .get<ItemStateMap>("/api/news/item-state")
      .then(setItemState)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 읽음 마킹: 상세가 열릴 때(자동 선택된 첫 항목 포함) 호출. 서버가 돌려준 전체 맵으로 재동기화.
  const markRead = (id: string) => {
    api
      .post<ItemStateMap>("/api/news/item-state/read", { id })
      .then(setItemState)
      .catch(() => {});
  };

  // 숨김 토글: 낙관적 업데이트 후 서버 확정 맵으로 재동기화(실패해도 다음 로드에서 맞춰짐).
  const toggleHidden = (id: string, hidden: boolean) => {
    setItemState((prev) => ({ ...prev, [id]: { ...prev[id], hidden: hidden || undefined } }));
    api
      .post<ItemStateMap>("/api/news/item-state/hide", { id, hidden })
      .then(setItemState)
      .catch(() => {});
  };

  // 숨김 버튼 클릭: 이미 확정 숨김(숨김 보기 중 해제)이면 즉시 반영, 아니면 목록에서 바로 지우지 않고
  // 보류 표시만 건다 — 다른 항목으로 이동할 때 커밋 effect가 실제로 숨긴다(실수 클릭 방지).
  const onHideClick = (id: string, committedHidden: boolean) => {
    if (committedHidden) {
      toggleHidden(id, false);
      return;
    }
    setPendingHide((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 선택이 다른 항목으로 바뀌면(다음/이전, 다른 카드 클릭) 그 사이 보류 중이던 숨김을 실제로 확정한다.
  useEffect(() => {
    const ids = pendingHideRef.current;
    if (ids.size === 0) return;
    setPendingHide(new Set());
    ids.forEach((id) => toggleHidden(id, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
  // hiddenView면 숨긴 항목만, 아니면 숨긴 항목을 제외한다(순차 탐색도 이 목록 기준).
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
    return pool
      .filter((it) => !excludedSources.has(it.source))
      .filter((it) => Boolean(itemState[it.id]?.hidden) === hiddenView);
  }, [feed, favOnly, favorites, excludedSources, itemState, hiddenView]);

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

  // 선택 시 원문 전문(마크다운) 보장: claude-code는 hasBody 경로로 별도 처리(스킵), yozm처럼
  // RSS content:encoded에서 이미 body를 확보한 소스는 재fetch 없이 그대로 채우고, 그 외는
  // 원문 페이지에서 1회 lazy-fetch.
  const ensureFullBody = (it: NewsItem) => {
    if (it.id in fullBodies || fullReq.current.has(it.id)) return;
    if (it.source === "claude-code") return; // hasBody 경로가 번역까지 포함해 따로 렌더 — full 미사용.
    if (it.body) {
      setFullBodies((p) => ({ ...p, [it.id]: it.body! }));
      return;
    }
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

  // 순차 탐색: 현재 필터된 목록(visibleItems) 기준 상대 이동. 범위 밖이면 no-op(경계에서 버튼 비활성화로 방지).
  const selectByOffset = (offset: number) => {
    const idx = visibleItems.findIndex((it) => it.id === selectedId);
    if (idx < 0) return;
    const next = visibleItems[idx + offset];
    if (next) setSelectedId(next.id);
  };

  const onSavedKey = (ok: boolean) => setKeyConfigured(ok); // true면 (A) effect가 재실행돼 번역 시작

  // 날짜별 그룹(visibleItems는 이미 시각 역순 정렬됨). feed 로드 전에는 빈 배열.
  const groups: { day: string; items: NewsItem[] }[] = [];
  for (const it of visibleItems) {
    const day = fmtDay(it.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }

  const showKeyPanel = mode !== "en" && keyConfigured === false;
  // 선택 항목: 피드 우선, 없으면 즐겨찾기 스냅샷(피드에서 빠진 즐겨찾기 상세가 비지 않게).
  const selected =
    selectedId && feed
      ? (feed.items.find((it) => it.id === selectedId) ?? favorites[selectedId] ?? null)
      : null;
  const selectedIndex = selectedId ? visibleItems.findIndex((it) => it.id === selectedId) : -1;
  const hiddenCount = Object.values(itemState).filter((s) => s.hidden).length;

  return (
    <div className="news-page">
      <h2>News</h2>
      <div className="news-segment-toggle">
        <div className="news-mode-toggle" role="group" aria-label="segment">
          <button
            className={`mode-btn${segment === "articles" ? " active" : ""}`}
            onClick={() => setSegment("articles")}
          >
            기사
          </button>
          <button
            className={`mode-btn${segment === "github-stars" ? " active" : ""}`}
            onClick={() => setSegment("github-stars")}
          >
            GitHub Stars
          </button>
        </div>
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
      </div>
      {showKeyPanel && <DeepLKeyPanel t={t} onSaved={onSavedKey} />}

      {segment === "github-stars" ? (
        <GitHubStars
          mode={mode}
          keyConfigured={keyConfigured}
          onKeyMissing={() => setKeyConfigured(false)}
        />
      ) : error && !feed ? (
        <div className="banner err">{error}</div>
      ) : !feed ? (
        <div className="muted">{t.loading}</div>
      ) : (
        <>
          <div className="news-toolbar">
            <button className="update-btn" onClick={refresh} disabled={refreshing}>
              {refreshing ? t.refreshing : t.refresh}
            </button>
            <span className="muted">
              {t.lastUpdate} {feed.lastFetch ? fmtRelative(feed.lastFetch) : "—"}
            </span>
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
              className={`news-fav-toggle${hiddenView ? " on" : ""}`}
              onClick={() => setHiddenView((v) => !v)}
              title={t.hiddenView}
            >
              <EyeIcon off={hiddenView} /> {t.hiddenView}
              {hiddenCount > 0 && <span className="cat-count">{hiddenCount}</span>}
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
                        <span className={`bdg ${SOURCE_BDG[s.source]}`}>
                          {SOURCE_LABEL[s.source]}
                        </span>
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
                    <button
                      onClick={() => setExcludedSources(new Set(feed.sources.map((s) => s.source)))}
                    >
                      {mode === "en" ? "Hide all" : "모두 숨기기"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

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
                <div className="muted cat-master-empty">
                  {hiddenView ? t.hiddenEmpty : favOnly ? t.favEmpty : t.empty}
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.day}>
                    <div className="timeline-day">{g.day}</div>
                    {g.items.map((it) => {
                      const fav = it.id in favorites;
                      const state = itemState[it.id];
                      const committed = Boolean(state?.hidden);
                      const pending = pendingHide.has(it.id);
                      const hideActive = committed || pending;
                      return (
                        <button
                          key={it.id}
                          className={`cat-master-item${selectedId === it.id ? " active" : ""}${state?.lastReadAt ? " is-read" : ""}`}
                          onClick={() => select(it)}
                        >
                          <div className="cat-mi-head">
                            <span className={`bdg ${SOURCE_BDG[it.source]}`}>
                              {SOURCE_LABEL[it.source]}
                            </span>
                            <span className="cat-mi-name">
                              {titleText(it, mode, trans[it.id]?.titleKo)}
                            </span>
                            {/* 행 전체가 button이라 별표/숨김은 span role=button + stopPropagation로 중첩 회피 */}
                            <span className="cat-mi-actions">
                              <span
                                role="button"
                                tabIndex={0}
                                className={`news-hide-btn${hideActive ? " on" : ""}`}
                                title={committed ? t.unhideBtn : pending ? t.cancelHide : t.hideBtn}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onHideClick(it.id, committed);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onHideClick(it.id, committed);
                                  }
                                }}
                              >
                                <EyeIcon off={hideActive} />
                              </span>
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
                            </span>
                          </div>
                          <div className="cat-mi-meta">
                            <span>{fmtTime(it.timestamp)}</span>
                            {it.meta && <span>{it.meta}</span>}
                            {state?.lastReadAt && (
                              <span className="t-tag" title={new Date(state.lastReadAt).toLocaleString()}>
                                ✓ {fmtClock(state.lastReadAt)}
                              </span>
                            )}
                            {pending && <span className="t-tag pending-tag">{t.pendingHideTag}</span>}
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
                    full={selected.body ?? fullBodies[selected.id]}
                    fetched={Boolean(selected.body) || selected.id in fullBodies}
                    bookmarked={selected.id in favorites}
                    onToggleFav={toggleFavorite}
                    onExport={(it) => void runExport([it.id])}
                    exporting={exporting}
                    onNeedBody={ensureBody}
                    onNeedImage={ensureImage}
                    onNeedFull={ensureFullBody}
                    hidden={Boolean(itemState[selected.id]?.hidden)}
                    pending={pendingHide.has(selected.id)}
                    onToggleHidden={onHideClick}
                    lastReadAt={itemState[selected.id]?.lastReadAt}
                    onRead={markRead}
                    hasPrev={selectedIndex > 0}
                    hasNext={selectedIndex >= 0 && selectedIndex < visibleItems.length - 1}
                    onPrev={() => selectByOffset(-1)}
                    onNext={() => selectByOffset(1)}
                    position={
                      selectedIndex >= 0
                        ? { index: selectedIndex + 1, total: visibleItems.length }
                        : null
                    }
                  />
                ) : (
                  <div className="cat-detail-empty">왼쪽에서 뉴스를 선택하세요.</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// 숨김 토글 아이콘(눈모양 흑백 SVG, currentColor로 hover/active 색을 그대로 상속).
// off=true(숨겨진 항목/숨김 보기 중)는 슬래시를 그어 "숨겨짐"을 표현.
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
  hidden: boolean;
  pending: boolean; // 숨김 보류 중(아직 커밋 전) — 다른 항목으로 이동하면 실제로 숨겨진다.
  onToggleHidden: (id: string, committedHidden: boolean) => void;
  lastReadAt?: number;
  onRead: (id: string) => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  position: { index: number; total: number } | null;
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

  // 선택 시(자동 선택된 첫 항목 포함) 읽음으로 마킹.
  useEffect(() => {
    onRead(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const hasBody = item.source === "claude-code" && !!item.body;
  const html = (md: string) => ({ __html: renderMarkdownSafe(md) });

  return (
    <div className="cat-detail">
      {position && (
        <div className="cat-detail-nav">
          <button className="cat-nav-btn" onClick={onPrev} disabled={!hasPrev}>
            {t.prevBtn}
          </button>
          <span className="muted">
            {position.index} / {position.total}
          </span>
          <button className="cat-nav-btn" onClick={onNext} disabled={!hasNext}>
            {t.nextBtn}
          </button>
        </div>
      )}
      <div className="cat-detail-title">
        <span className={`bdg ${SOURCE_BDG[item.source]}`}>{SOURCE_LABEL[item.source]}</span>
        <span className="cat-detail-name">{titleText(item, mode, ko?.titleKo)}</span>
        <div className="cat-detail-actions">
          <button
            className={`news-star-btn${bookmarked ? " on" : ""}`}
            onClick={() => onToggleFav(item)}
            title={bookmarked ? t.bookmarked : t.bookmark}
          >
            {bookmarked ? "★" : "☆"} {t.bookmark}
          </button>
          <button
            className={`news-star-btn${hidden || pending ? " on" : ""}`}
            onClick={() => onToggleHidden(item.id, hidden)}
            title={hidden ? t.unhideBtn : pending ? t.cancelHide : t.hideBtn}
          >
            <EyeIcon off={hidden || pending} /> {hidden ? t.unhideBtn : pending ? t.cancelHide : t.hideBtn}
          </button>
          <button className="news-star-btn" onClick={() => onExport(item)} disabled={exporting} title={t.exportOne}>
            ⬇ md
          </button>
        </div>
      </div>
      <div className="cat-detail-meta">
        {new Date(item.timestamp).toLocaleString()}
        {item.meta ? ` · ${item.meta}` : ""}
        {lastReadAt ? ` · ${t.lastRead} ${new Date(lastReadAt).toLocaleString()}` : ""}
        {pending ? ` · ${t.pendingHideTag}` : ""}
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
