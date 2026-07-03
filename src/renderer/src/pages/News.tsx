import { useEffect, useRef, useState, type ReactNode } from "react";
import { marked } from "marked";
import { api, fmtDay, fmtTime, fmtRelative } from "../api/client";
import type {
  NewsFeed,
  NewsItem,
  NewsSource,
  ItemTranslation,
  SecretStatus,
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
  const [trans, setTrans] = useState<Record<string, ItemTranslation>>({});
  const [transErr, setTransErr] = useState("");
  const [translating, setTranslating] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [images, setImages] = useState<Record<string, string>>({}); // id → 해석된 og:image URL(lazy)
  const bodyReq = useRef<Set<string>>(new Set()); // 본문 번역 중복 요청 방지
  const imgReq = useRef<Set<string>>(new Set()); // 이미지 중복 요청 방지
  const filterRef = useRef<HTMLDivElement>(null);

  const t = mode === "en" ? UI.en : UI.ko;

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify([...excludedSources]));
  }, [excludedSources]);

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
  }, []);

  // 선택 유지/자동선택: feed 로드·필터 변경 시 현재 선택이 표시 목록에 있으면 유지, 없으면 첫 항목을
  // 자동 선택(읽기용 표면이라 우측 상세가 비어 보이지 않게). 표시할 항목이 없으면 선택 해제.
  useEffect(() => {
    if (!feed) return;
    const vis = feed.items.filter((it) => !excludedSources.has(it.source));
    setSelectedId((cur) => {
      if (vis.length === 0) return null;
      if (cur && vis.some((it) => it.id === cur)) return cur;
      return vis[0].id;
    });
  }, [feed, excludedSources]);

  // (A) 목록 제목 일괄 번역: ko/both + feed 준비 + 키 설정됨 + 미번역 존재. trans는 의도적 제외(루프 방지).
  useEffect(() => {
    if (mode === "en" || !feed || keyConfigured !== true) return;
    const missing = feed.items
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
  }, [mode, feed, keyConfigured]);

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

  // 날짜별 그룹(items는 이미 시각 역순 정렬됨). 소스 필터는 표시에만 적용(번역 대상 판단은 feed.items 그대로).
  const visibleItems = feed.items.filter((it) => !excludedSources.has(it.source));
  const groups: { day: string; items: NewsItem[] }[] = [];
  for (const it of visibleItems) {
    const day = fmtDay(it.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }

  const showKeyPanel = mode !== "en" && keyConfigured === false;
  const selected = feed.items.find((it) => it.id === selectedId) ?? null;

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

      <div className="cat-split news-split">
        <div className="ws-master news-master">
          {visibleItems.length === 0 ? (
            <div className="muted cat-master-empty">{t.empty}</div>
          ) : (
            groups.map((g) => (
              <div key={g.day}>
                <div className="timeline-day">{g.day}</div>
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    className={`cat-master-item${selectedId === it.id ? " active" : ""}`}
                    onClick={() => select(it)}
                  >
                    <div className="cat-mi-head">
                      <span className={`bdg ${SOURCE_BDG[it.source]}`}>{SOURCE_LABEL[it.source]}</span>
                      <span className="cat-mi-name">{titleText(it, mode, trans[it.id]?.titleKo)}</span>
                    </div>
                    <div className="cat-mi-meta">
                      <span>{fmtTime(it.timestamp)}</span>
                      {it.meta && <span>{it.meta}</span>}
                    </div>
                  </button>
                ))}
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
                onNeedBody={ensureBody}
                onNeedImage={ensureImage}
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

/** 상세 패널: claude-code는 body(패치노트) 마크다운을 모드별로 렌더, 한국어 RSS는 summary 평문, 그 외는 메타 + 원문 열기. */
function NewsDetail({
  item,
  mode,
  t,
  ko,
  image,
  onNeedBody,
  onNeedImage,
}: {
  item: NewsItem;
  mode: Mode;
  t: UIText;
  ko?: ItemTranslation;
  image?: string;
  onNeedBody: (it: NewsItem) => void;
  onNeedImage: (it: NewsItem) => void;
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

  const hasBody = item.source === "claude-code" && !!item.body;
  const html = (md: string) => ({ __html: marked.parse(md) as string });

  return (
    <div className="cat-detail">
      <div className="cat-detail-title">
        <span className={`bdg ${SOURCE_BDG[item.source]}`}>{SOURCE_LABEL[item.source]}</span>
        <span className="cat-detail-name">{titleText(item, mode, ko?.titleKo)}</span>
      </div>
      <div className="cat-detail-meta">
        {new Date(item.timestamp).toLocaleString()}
        {item.meta ? ` · ${item.meta}` : ""}
      </div>
      {image && (
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
      ) : item.summary ? (
        // 서드파티 HTML 주입 차단 — summary는 main에서 정제된 평문이며 평문으로만 렌더한다.
        <p className="news-summary">{item.summary}</p>
      ) : null}
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
