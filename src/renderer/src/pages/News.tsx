import { useEffect, useRef, useState } from "react";
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
  ai: "AI",
};
const SOURCE_BDG: Record<NewsSource, string> = {
  "claude-code": "bdg-cc",
  anthropic: "bdg-anthropic",
  ai: "bdg-ai",
};

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) as Mode) || "en");
  const [trans, setTrans] = useState<Record<string, ItemTranslation>>({});
  const [transErr, setTransErr] = useState("");
  const [translating, setTranslating] = useState(false);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const bodyReq = useRef<Set<string>>(new Set()); // 본문 번역 중복 요청 방지

  const t = mode === "en" ? UI.en : UI.ko;

  useEffect(() => {
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);

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

  // (A) 목록 제목 일괄 번역: ko/both + feed 준비 + 키 설정됨 + 미번역 존재. trans는 의도적 제외(루프 방지).
  useEffect(() => {
    if (mode === "en" || !feed || keyConfigured !== true) return;
    const missing = feed.items.filter((i) => !trans[i.id]?.titleKo).map((i) => i.id);
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

  const toggle = (it: NewsItem) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(it.id)) next.delete(it.id);
      else next.add(it.id);
      return next;
    });

  const onSavedKey = (ok: boolean) => setKeyConfigured(ok); // true면 (A) effect가 재실행돼 번역 시작

  const renderTitle = (it: NewsItem) => {
    const ko = trans[it.id]?.titleKo;
    if (mode === "en") return <span className="timeline-title">{it.title}</span>;
    if (mode === "ko") return <span className="timeline-title">{ko ?? it.title}</span>;
    return (
      <span className="timeline-title">
        {it.title}
        {ko && <span className="title-ko"> · {ko}</span>}
      </span>
    );
  };

  if (error && !feed) return <div className="banner err">{error}</div>;
  if (!feed) return <div className="muted">{t.loading}</div>;

  // 날짜별 그룹(items는 이미 시각 역순 정렬됨).
  const groups: { day: string; items: NewsItem[] }[] = [];
  for (const it of feed.items) {
    const day = fmtDay(it.timestamp);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(it);
    else groups.push({ day, items: [it] });
  }

  const showKeyPanel = mode !== "en" && keyConfigured === false;

  return (
    <div>
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
        <span className="news-sources">
          {feed.sources.map((s) => (
            <span
              key={s.source}
              className={`news-src ${s.ok ? "ok" : "err"}`}
              title={s.ok ? `${s.count}` : (s.error ?? t.failed)}
            >
              {SOURCE_LABEL[s.source]} {s.ok ? `· ${s.count}` : `· ${t.failed}`}
            </span>
          ))}
        </span>
      </div>

      {showKeyPanel && <DeepLKeyPanel t={t} onSaved={onSavedKey} />}
      {translating && <div className="muted news-translating-bar">{t.translating}</div>}
      {transErr && <div className="banner warn">{t.transFail}</div>}
      {error && <div className="banner err">{error}</div>}

      {feed.items.length === 0 ? (
        <div className="muted">{t.empty}</div>
      ) : (
        <div className="timeline">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="timeline-day">{g.day}</div>
              {g.items.map((it) => {
                const open = expanded.has(it.id);
                return (
                  <div className="timeline-row" key={it.id}>
                    <div className="timeline-item" onClick={() => toggle(it)}>
                      <span className={`bdg ${SOURCE_BDG[it.source]}`}>
                        {SOURCE_LABEL[it.source]}
                      </span>
                      <span className="timeline-time muted">{fmtTime(it.timestamp)}</span>
                      {renderTitle(it)}
                      {it.meta && <span className="timeline-proj muted">{it.meta}</span>}
                      <span className="timeline-caret muted">{open ? "▾" : "▸"}</span>
                    </div>
                    {open && (
                      <NewsExpand
                        item={it}
                        mode={mode}
                        t={t}
                        ko={trans[it.id]}
                        onNeedBody={ensureBody}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 펼침: claude-code는 body(패치노트) 마크다운을 모드별로 렌더, 그 외는 메타 + 원문 열기. */
function NewsExpand({
  item,
  mode,
  t,
  ko,
  onNeedBody,
}: {
  item: NewsItem;
  mode: Mode;
  t: UIText;
  ko?: ItemTranslation;
  onNeedBody: (it: NewsItem) => void;
}) {
  // 펼침 시(그리고 모드가 ko/both로 바뀔 때) 본문 번역을 보장.
  useEffect(() => {
    if (mode !== "en" && item.body && !ko?.bodyKo) onNeedBody(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, item.id, ko?.bodyKo]);

  const hasBody = item.source === "claude-code" && !!item.body;
  const html = (md: string) => ({ __html: marked.parse(md) as string });

  return (
    <div className="timeline-expand">
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
      ) : (
        <p>
          {SOURCE_LABEL[item.source]} · {new Date(item.timestamp).toLocaleString()}
          {item.meta ? ` · ${item.meta}` : ""}
        </p>
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
