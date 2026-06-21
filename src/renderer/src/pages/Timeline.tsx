import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { api, fmtDay, fmtTime } from "../api/client";
import {
  STATUSES,
  buildProjNameMap,
  shortName,
  type BoardStatus,
  type TimelineEvent,
  type WorkspaceProject,
} from "./workspace-shared";

const NONE_KEY = "__none__"; // projectId가 null인 이벤트(프로젝트 없음)의 필터 키

// 날짜별 세션/계획 이벤트 타임라인. "N일 공백" 구분선으로 주말 갭을 가시화한다.
// 행을 클릭하면 펼쳐서 내용(세션 스니펫 / 계획 본문)을 보여준다.
export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // 숨긴 프로젝트(기본 전부 표시)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 펼친 이벤트(eventKey)
  const [error, setError] = useState("");

  const reload = () =>
    api
      .get<TimelineEvent[]>("/api/workspace/timeline")
      .then(setEvents)
      .catch((e) => setError(e.message));

  useEffect(() => {
    reload();
    api
      .get<WorkspaceProject[]>("/api/workspace/projects")
      .then(setProjects)
      .catch(() => {});
  }, []);

  // projectId → 표시 이름(nameOverride 반영). 같은 프로젝트면 session/plan 이벤트가 동일 이름을 쓴다.
  const projName = useMemo(() => buildProjNameMap(projects), [projects]);

  const label = (e: TimelineEvent) =>
    e.projectId ? projName.get(e.projectId) ?? shortName(e.realPath, e.projectId) : "";

  // 이벤트에 실제 등장한 프로젝트만 칩으로(전체 목록이 아니라). null은 "프로젝트 없음".
  const chips = useMemo(() => {
    if (!events) return [];
    const seen = new Map<string, string>();
    for (const e of events) {
      const key = e.projectId ?? NONE_KEY;
      if (seen.has(key)) continue;
      seen.set(key, e.projectId ? label(e) || e.projectId : "프로젝트 없음");
    }
    return [...seen.entries()].map(([key, name]) => ({ key, name }));
  }, [events, projName]);

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // 낙관적 업데이트 → 실패 시 서버값으로 재동기화(ProjectsView/PlansView patch 패턴).
  async function patchStatus(e: TimelineEvent, status: BoardStatus) {
    setEvents((prev) =>
      prev ? prev.map((x) => (sameEvent(x, e) ? { ...x, status } : x)) : prev,
    );
    const url =
      e.kind === "plan"
        ? `/api/workspace/board/plan/${encodeURIComponent(e.filename!)}`
        : `/api/workspace/board/session/${encodeURIComponent(e.sessionId!)}`;
    try {
      await api.post(url, { status });
    } catch (err) {
      setError((err as Error).message);
      reload();
    }
  }

  if (error) return <div className="banner err">{error}</div>;
  if (!events) return <div className="muted">불러오는 중…</div>;
  if (events.length === 0) return <div className="muted">활동 기록이 없습니다.</div>;

  // 필터 적용 후 날짜별 그룹(빈 그룹은 자연 소거, "N일 공백"도 그에 맞게 재계산)
  const shown = events.filter((e) => !hidden.has(e.projectId ?? NONE_KEY));
  const groups: { day: string; items: TimelineEvent[] }[] = [];
  for (const e of shown) {
    const day = fmtDay(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <div>
      <h2>Timeline</h2>
      {chips.length > 0 && (
        <div className="timeline-filters">
          {chips.map((c) => (
            <button
              key={c.key}
              className={`timeline-chip${hidden.has(c.key) ? " off" : ""}`}
              onClick={() => toggle(c.key)}
              title={hidden.has(c.key) ? "표시" : "숨기기"}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      <div className="timeline">
        {groups.map((g, i) => {
          const prev = groups[i - 1];
          const gapDays = prev
            ? Math.round(
                (new Date(prev.day).getTime() - new Date(g.day).getTime()) / 86400000,
              )
            : 0;
          return (
            <div key={g.day}>
              {gapDays > 1 && <div className="timeline-gap">· {gapDays - 1}일 공백 ·</div>}
              <div className="timeline-day">{g.day}</div>
              {g.items.map((e) => {
                const key = eventKey(e);
                const isOpen = expanded.has(key);
                return (
                  <div className="timeline-row" key={key}>
                    <div className="timeline-item" onClick={() => toggleExpand(key)}>
                      <span className={`bdg ${e.kind === "plan" ? "bdg-plan" : "bdg-session"}`}>
                        {e.kind === "plan" ? "PLAN" : "SESS"}
                      </span>
                      <span className="timeline-time muted">{fmtTime(e.ts)}</span>
                      <span className="timeline-title">{e.title}</span>
                      <span className="timeline-proj muted">{label(e)}</span>
                      <select
                        className="ws-select"
                        value={e.status}
                        disabled={e.kind === "session" && !e.sessionId}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={(ev) => patchStatus(e, ev.target.value as BoardStatus)}
                        title="상태 (자동추정 기본값 · 수동 변경 시 저장)"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <span className="timeline-caret muted">{isOpen ? "▾" : "▸"}</span>
                    </div>
                    {isOpen && <TimelineExpand e={e} />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 펼침 패널: 세션은 스니펫(이미 받은 값), 계획은 본문을 lazy-fetch. */
function TimelineExpand({ e }: { e: TimelineEvent }) {
  if (e.kind === "plan" && e.filename) {
    return <PlanBody filename={e.filename} archived={!!e.archived} />;
  }
  if (!e.lastPrompt && !e.lastAssistantSnippet) {
    return <div className="timeline-expand muted">표시할 내용이 없습니다.</div>;
  }
  return (
    <div className="timeline-expand">
      {e.lastPrompt && (
        <p className="tl-prompt">
          <span className="ws-line-k">마지막 입력</span> {e.lastPrompt}
        </p>
      )}
      {e.lastAssistantSnippet && (
        <div>
          <span className="ws-line-k">마지막 응답</span>
          <div
            className="md-body ws-snippet-md"
            dangerouslySetInnerHTML={{
              __html: marked.parse(e.lastAssistantSnippet, { breaks: true }) as string,
            }}
          />
        </div>
      )}
    </div>
  );
}

function PlanBody({ filename, archived }: { filename: string; archived: boolean }) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .get<{ raw: string }>(
        `/api/workspace/plan/content?filename=${encodeURIComponent(filename)}&archived=${
          archived ? 1 : 0
        }`,
      )
      .then((c) => alive && setBody(c.raw))
      .catch(() => alive && setBody("(본문을 불러오지 못했습니다)"));
    return () => {
      alive = false;
    };
  }, [filename, archived]);
  return (
    <div
      className="timeline-expand md-body ws-planbody"
      dangerouslySetInnerHTML={{ __html: marked.parse(body ?? "불러오는 중…") as string }}
    />
  );
}

/** plan은 filename, session은 sessionId로 식별(낙관적 업데이트/React key 안정화). */
function eventKey(e: TimelineEvent): string {
  return e.filename ?? e.sessionId ?? `${e.kind}-${e.ts}`;
}
function sameEvent(a: TimelineEvent, b: TimelineEvent): boolean {
  return eventKey(a) === eventKey(b);
}
