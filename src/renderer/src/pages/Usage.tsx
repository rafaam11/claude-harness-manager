import { useEffect, useMemo, useState } from "react";
import { api, fmtTime } from "../api/client";
import type {
  ProviderFilter,
  UsageCaptureStatus,
  UsageQuotaWindow,
  UsageSummary,
  UsageTokenWindow,
} from "@shared/types";
import { providerGroupLabel, providerToneClass } from "../provider-ui";

interface Props {
  providerFilter: ProviderFilter;
}

function fmtNumber(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n);
}

function fmtReset(iso: string | null): string {
  if (!iso) return "reset 미확인";
  return `${new Date(iso).toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  })} ${fmtTime(Date.parse(iso))}`;
}

function fmtObserved(iso: string | null): string {
  if (!iso) return "관측 없음";
  return `${new Date(iso).toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  })} ${fmtTime(Date.parse(iso))}`;
}

function pctLabel(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(value % 1 ? 1 : 0)}%`;
}

function WindowBar({
  title,
  window,
  stale,
}: {
  title: string;
  window: UsageQuotaWindow;
  stale: boolean;
}) {
  const pct = window.usedPercent ?? 0;
  return (
    <div className="usage-window">
      <div className="usage-window-head">
        <span>{title}</span>
        <strong>{pctLabel(window.usedPercent)}</strong>
      </div>
      <div className="usage-bar" aria-label={`${title} 사용률 ${pctLabel(window.usedPercent)}`}>
        <div
          className={`usage-fill${stale ? " stale" : ""}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <div className="usage-window-sub">
        <span>{window.windowMinutes.toLocaleString("ko-KR")}분 창</span>
        <span>{fmtReset(window.resetAt)}</span>
      </div>
    </div>
  );
}

function TokenBox({ title, tokens }: { title: string; tokens: UsageTokenWindow }) {
  const rows = [
    ["Input", tokens.inputTokens],
    ["Cached", tokens.cachedInputTokens],
    ["Cache create", tokens.cacheCreationInputTokens],
    ["Cache read", tokens.cacheReadInputTokens],
    ["Output", tokens.outputTokens],
    ["Reasoning", tokens.reasoningOutputTokens],
  ] as const;
  return (
    <div className="usage-token-box">
      <div className="usage-token-head">
        <span>{title}</span>
        <strong>{fmtNumber(tokens.totalTokens)}</strong>
      </div>
      <div className="usage-token-sub">{fmtNumber(tokens.eventCount)}개 이벤트</div>
      <div className="usage-token-rows">
        {rows.map(([label, value]) => (
          <div key={label} className="usage-token-row">
            <span>{label}</span>
            <strong>{fmtNumber(value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function CapturePanel({
  capture,
  onSetup,
  onDisable,
  busy,
}: {
  capture: UsageCaptureStatus | undefined;
  onSetup: () => Promise<void>;
  onDisable: () => Promise<void>;
  busy: boolean;
}) {
  if (!capture) return null;
  return (
    <div className={`usage-capture ${capture.enabled ? "enabled" : ""}`}>
      <div>
        <strong>Claude 한도 % 캡처</strong>
        <p>
          {capture.enabled
            ? "statusLine proxy가 켜져 있어 Claude가 statusLine을 호출할 때 한도 스냅샷을 저장합니다."
            : "Claude 한도 %는 transcript에 없어서 statusLine stdin 스냅샷 캡처가 필요합니다."}
        </p>
        <code>{capture.proxyPath}</code>
      </div>
      <div className="usage-capture-actions">
        {capture.enabled ? (
          <button type="button" className="danger" onClick={onDisable} disabled={busy}>
            캡처 원복
          </button>
        ) : (
          <button type="button" onClick={onSetup} disabled={busy}>
            캡처 설정
          </button>
        )}
      </div>
    </div>
  );
}

function UsageCard({
  summary,
  onCaptureSetup,
  onCaptureDisable,
  busy,
}: {
  summary: UsageSummary;
  onCaptureSetup: () => Promise<void>;
  onCaptureDisable: () => Promise<void>;
  busy: boolean;
}) {
  const unavailable = summary.quota.source === "unavailable";
  return (
    <section className={`usage-card ${providerToneClass(summary.provider)}`}>
      <div className="usage-card-head">
        <div>
          <div className="usage-provider">{providerGroupLabel(summary.provider)}</div>
          <h2>{summary.provider === "claude" ? "Claude Code" : "Codex"}</h2>
        </div>
        <div className={`usage-state ${unavailable ? "muted" : summary.quota.stale ? "warn" : "ok"}`}>
          {unavailable ? "한도 미연동" : summary.quota.stale ? "오래된 관측" : "최신 관측"}
        </div>
      </div>

      <div className="usage-meta">
        <span>한도 출처: {summary.quota.source}</span>
        <span>최근 관측: {fmtObserved(summary.quota.observedAt)}</span>
        {summary.quota.planType && <span>Plan: {summary.quota.planType}</span>}
      </div>

      {summary.quota.message && <div className="usage-note">{summary.quota.message}</div>}
      {summary.errors.length > 0 && (
        <div className="usage-note error">일부 로그를 읽지 못했습니다: {summary.errors[0]}</div>
      )}

      <div className="usage-windows">
        <WindowBar title="최근 5시간 한도" window={summary.quota.fiveHour} stale={summary.quota.stale} />
        <WindowBar title="주간 한도" window={summary.quota.weekly} stale={summary.quota.stale} />
      </div>

      <div className="usage-token-grid">
        <TokenBox title="최근 5시간 토큰" tokens={summary.tokens.fiveHour} />
        <TokenBox title="최근 7일 토큰" tokens={summary.tokens.weekly} />
      </div>

      {summary.provider === "claude" && (
        <CapturePanel
          capture={summary.capture}
          onSetup={onCaptureSetup}
          onDisable={onCaptureDisable}
          busy={busy}
        />
      )}
    </section>
  );
}

export default function Usage({ providerFilter }: Props) {
  const [items, setItems] = useState<UsageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => `/api/usage?provider=${encodeURIComponent(providerFilter)}`, [providerFilter]);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      setItems(await api.get<UsageSummary[]>(query));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setError(null);
    setLoading(true);
    api
      .get<UsageSummary[]>(query)
      .then((data) => {
        if (alive) setItems(data);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [query]);

  const runCapture = async (kind: "setup" | "disable") => {
    setBusy(true);
    try {
      if (kind === "setup") await api.post<UsageCaptureStatus>("/api/usage/claude-capture/setup");
      else await api.post<UsageCaptureStatus>("/api/usage/claude-capture/disable");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="usage-page">
      <div className="page-head usage-page-head">
        <div>
          <h2>사용량</h2>
          <p>Claude와 Codex의 최근 5시간/주간 한도와 transcript 기반 토큰 사용량을 로컬에서 집계합니다.</p>
        </div>
        <button type="button" onClick={load} disabled={loading || busy}>
          새로고침
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {loading ? (
        <div className="empty">사용량을 읽는 중...</div>
      ) : items.length === 0 ? (
        <div className="empty">선택한 provider의 사용량 데이터가 없습니다.</div>
      ) : (
        <div className="usage-grid">
          {items.map((summary) => (
            <UsageCard
              key={summary.provider}
              summary={summary}
              busy={busy}
              onCaptureSetup={() => runCapture("setup")}
              onCaptureDisable={() => runCapture("disable")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
