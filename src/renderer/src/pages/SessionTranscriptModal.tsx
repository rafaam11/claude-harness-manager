import { useEffect, useRef, useState } from "react";
import { api, fmtClock, fmtDay } from "../api/client";
import { renderMarkdownSafe } from "../markdown";
import type { LiveSessionTodos, SessionTranscript } from "@shared/provider-types";

/** 세션 행 클릭이 여는 팝업의 대상. todos는 실행 중 세션에서만 실린다. */
export interface SessionModalTarget {
  sessionId: string;
  title: string;
  todos?: LiveSessionTodos | null;
}

export const TODO_MARK: Record<string, string> = { completed: "✓", in_progress: "▸", pending: "·" };

export function LiveTodoList({ items }: { items: LiveSessionTodos["items"] }) {
  return (
    <ul className="tl-live-todos">
      {items.map((item) => (
        <li key={item.id} className={`todo-${item.status}`}>
          <span className="tl-todo-mark" aria-hidden="true">
            {TODO_MARK[item.status] ?? "·"}
          </span>
          {item.status === "in_progress" ? item.activeForm ?? item.subject : item.subject}
        </li>
      ))}
    </ul>
  );
}

/** 한 버블의 도구 호출을 "Edit ×3" 식으로 압축한다(등장 순서 보존). */
export function summarizeToolUses(toolUses: string[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of toolUses) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count }));
}

function msgTime(ts: string | null): string | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return `${fmtDay(ms)} ${fmtClock(ms)}`;
}

function TranscriptBody({
  sessionId,
  scrollRef,
}: {
  sessionId: string;
  scrollRef: React.RefObject<HTMLDivElement>;
}) {
  const [data, setData] = useState<SessionTranscript | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    api
      .get<SessionTranscript>(`/api/workspace/session/transcript?id=${encodeURIComponent(sessionId)}`)
      .then((t) => alive && setData(t))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // 채팅 앱 관례대로 최신 대화(맨 아래)부터 보여준다.
  useEffect(() => {
    if (!data) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data, scrollRef]);

  if (error) return <div className="banner err">{error}</div>;
  if (!data) return <div className="muted">대화를 불러오는 중…</div>;
  if (data.messages.length === 0) return <div className="muted">표시할 대화가 없습니다.</div>;
  return (
    <>
      {data.truncated && (
        <div className="session-modal-truncated muted">
          대화가 길어 앞부분은 생략됐습니다 — 최근 내용부터 표시합니다.
        </div>
      )}
      {data.messages.map((m, i) => {
        const time = msgTime(m.ts);
        return (
          <div key={i} className={`session-modal-msg session-modal-msg-${m.role}`}>
            <div className="session-modal-msg-head muted">
              <span>{m.role === "user" ? "나" : "어시스턴트"}</span>
              {time && <span>{time}</span>}
            </div>
            {m.text &&
              (m.role === "assistant" ? (
                <div
                  className="md-body ws-snippet-md"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(m.text, { breaks: true }) }}
                />
              ) : (
                <div className="session-modal-msg-text">{m.text}</div>
              ))}
            {m.toolUses.length > 0 && (
              <div className="session-modal-tools">
                {summarizeToolUses(m.toolUses).map(({ name, count }) => (
                  <span key={name} className="bdg bdg-model-missing" title={`${name} 도구 호출`}>
                    🔧 {name}
                    {count > 1 ? ` ×${count}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * 세션 전체 대화 팝업(Timeline/Workspace 공용). target이 null이면 아무것도 그리지 않으므로
 * 호출부는 항상 렌더해 두고 target으로만 열림/닫힘을 제어한다.
 */
export default function SessionTranscriptModal({
  target,
  onClose,
}: {
  target: SessionModalTarget | null;
  onClose: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  if (!target) return null;
  return (
    <div className="session-modal-overlay" onClick={onClose}>
      <div className="session-modal" onClick={(ev) => ev.stopPropagation()}>
        <div className="session-modal-header">
          <span className="session-modal-title" title={target.title}>
            {target.title}
          </span>
          <button className="ws-icon-btn session-modal-close" onClick={onClose} aria-label="닫기" title="닫기 (Esc)">
            ✕
          </button>
        </div>
        <div className="session-modal-body" ref={bodyRef}>
          {target.todos && target.todos.items.length > 0 && (
            <section className="session-modal-todos">
              <div className="ws-plans-head">
                할 일{" "}
                <span className="cat-count">
                  {target.todos.done}/{target.todos.total}
                </span>
              </div>
              <LiveTodoList items={target.todos.items} />
            </section>
          )}
          <TranscriptBody sessionId={target.sessionId} scrollRef={bodyRef} />
        </div>
      </div>
    </div>
  );
}
