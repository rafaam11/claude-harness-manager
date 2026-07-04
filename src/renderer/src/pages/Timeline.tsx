import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { api, fmtDay, fmtTime } from "../api/client";
import {
  STATUSES,
  buildProjNameMap,
  displayName,
  modelBadgeClass,
  modelDisplayName,
  shortName,
  type BoardStatus,
  type TimelineEvent,
  type WorkspaceProject,
} from "./workspace-shared";

const NONE_KEY = "__none__"; // projectId가 null인 이벤트(프로젝트 없음)의 탭 키

// 상태 → 좌측 점 색상 클래스(Workspace StatusTag의 st-0~3 색상 재사용)
function chipDotClass(status: BoardStatus | null): string {
  return status ? `st-${STATUSES.indexOf(status)}` : "st-none";
}

// 날짜별 세션/계획 이벤트 타임라인. "N일 공백" 구분선으로 주말 갭을 가시화한다.
// 행을 클릭하면 펼쳐서 내용(세션 스니펫 / 계획 본문)을 보여준다.
export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all"); // "all" | NONE_KEY | projectId
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 펼친 이벤트(eventKey)
  const [archiveOpen, setArchiveOpen] = useState(false); // 보관 프로젝트 관리(복원) 팝오버 열림 상태
  const [error, setError] = useState("");
  const archiveRef = useRef<HTMLDivElement>(null);

  // 보관 관리 팝오버 바깥 클릭 시 닫기
  useEffect(() => {
    if (!archiveOpen) return;
    const onClick = (ev: MouseEvent) => {
      if (archiveRef.current && !archiveRef.current.contains(ev.target as Node)) setArchiveOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [archiveOpen]);

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

  // projectId → board.status(무상태 null 포함). 탭 상태 점 표시에 사용.
  const projStatusById = useMemo(
    () => new Map<string, BoardStatus | null>(projects.map((p) => [p.id, p.board.status])),
    [projects],
  );

  // projectId → lastActivity(탭 정렬 기준)
  const projLastActivityById = useMemo(
    () => new Map<string, number>(projects.map((p) => [p.id, p.lastActivity])),
    [projects],
  );

  // 이벤트에 실제 등장한 프로젝트만 탭 후보로(전체 목록이 아니라). 아카이브(보관) 프로젝트는 후보에서 완전히 제외.
  // 최근 활동 내림차순 정렬("프로젝트 없음"은 항상 마지막).
  const projectTabs = useMemo(() => {
    if (!events) return [];
    const counts = new Map<string, { name: string; count: number; status: BoardStatus | null }>();
    for (const e of events) {
      const status = e.projectId ? projStatusById.get(e.projectId) ?? null : null;
      if (status === "보관") continue;
      const key = e.projectId ?? NONE_KEY;
      const name = e.projectId ? label(e) || e.projectId : "프로젝트 없음";
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { name, count: 1, status });
    }
    return [...counts.entries()]
      .map(([key, v]) => ({ key, name: v.name, count: v.count, status: v.status }))
      .sort((a, b) => {
        if (a.key === NONE_KEY) return 1;
        if (b.key === NONE_KEY) return -1;
        const at = projLastActivityById.get(a.key) ?? 0;
        const bt = projLastActivityById.get(b.key) ?? 0;
        return bt - at || b.count - a.count;
      });
  }, [events, projName, projStatusById, projLastActivityById]);

  // 활성 탭이 더 이상 유효하지 않으면(예: 보고 있던 프로젝트의 이벤트가 사라짐) "전체"로 리셋.
  useEffect(() => {
    if (activeTab === "all") return;
    if (!projectTabs.some((t) => t.key === activeTab)) setActiveTab("all");
  }, [projectTabs, activeTab]);

  // 관리 목록에 보여줄 아카이브(보관) 프로젝트. 이벤트 유무와 무관하게 프로젝트 전체 기준.
  const archivedProjects = useMemo(
    () => projects.filter((p) => p.board.status === "보관"),
    [projects],
  );

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const totalShownCount = projectTabs.reduce((sum, t) => sum + t.count, 0);

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

  // 프로젝트 아카이브/복원: Workspace의 board.status("보관")를 그대로 재사용(Workspace와 연동).
  // 아카이브된 프로젝트는 탭 후보/타임라인에서 완전히 제외되고, 하단 관리 목록에서만 복원 가능.
  async function setProjectStatus(projectId: string, status: BoardStatus) {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, board: { ...p.board, status } } : p)),
    );
    if (status === "보관" && activeTab === projectId) setActiveTab("all");
    try {
      await api.post(`/api/workspace/board/project/${encodeURIComponent(projectId)}`, { status });
    } catch (err) {
      setError((err as Error).message);
      api
        .get<WorkspaceProject[]>("/api/workspace/projects")
        .then(setProjects)
        .catch(() => {});
    }
  }

  if (error) return <div className="banner err">{error}</div>;
  if (!events) return <div className="muted">불러오는 중…</div>;
  if (events.length === 0) return <div className="muted">활동 기록이 없습니다.</div>;

  // 활성 탭 기준으로 이벤트 필터링(보관 프로젝트는 탭 무관 항상 제외).
  const shown = events.filter((e) => {
    if (e.projectId && projStatusById.get(e.projectId) === "보관") return false;
    if (activeTab === "all") return true;
    return (e.projectId ?? NONE_KEY) === activeTab;
  });

  // 시간 근접으로 추정된 계획을 부모 세션의 자식으로 묶는다(들여쓰기 표시용).
  // 부모가 필터로 화면에 없으면 자식도 최상위 flat 행으로 남는다.
  const visibleSessionIds = new Set(
    shown.filter((e) => e.kind === "session" && e.sessionId).map((e) => e.sessionId!),
  );
  const childrenBySession = new Map<string, TimelineEvent[]>();
  for (const e of shown) {
    if (e.kind === "plan" && e.parentSessionId && visibleSessionIds.has(e.parentSessionId)) {
      const arr = childrenBySession.get(e.parentSessionId) ?? [];
      arr.push(e);
      childrenBySession.set(e.parentSessionId, arr);
    }
  }
  const topLevel = shown.filter(
    (e) => !(e.kind === "plan" && e.parentSessionId && visibleSessionIds.has(e.parentSessionId)),
  );

  // 날짜별 그룹(빈 그룹은 자연 소거, "N일 공백"도 그에 맞게 재계산). 자식 계획은 부모 세션의
  // 슬롯 아래 붙으므로 별도 날짜로 그룹화되지 않는다(자정을 걸쳐도 의도적으로 부모 쪽에 붙임).
  const groups: { day: string; items: TimelineEvent[] }[] = [];
  for (const e of topLevel) {
    const day = fmtDay(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  // 세션/자식 계획 행 렌더링. isChild면 들여쓰기하고, 부모와 날짜가 다를 때만 날짜를 함께 보여준다.
  // 프로젝트명은 "전체" 탭에서만 보여준다(특정 프로젝트 탭에서는 탭 자체가 이미 알려주므로 중복).
  const renderRow = (e: TimelineEvent, isChild: boolean, parentDay?: string) => {
    const key = eventKey(e);
    const isOpen = expanded.has(key);
    const showDay = isChild && parentDay !== undefined && fmtDay(e.ts) !== parentDay;
    return (
      <div className={`timeline-row${isChild ? " timeline-row-child" : ""}`} key={key}>
        <div className="timeline-item" onClick={() => toggleExpand(key)}>
          {e.kind === "plan" && <span className="bdg bdg-plan">PLAN</span>}
          {e.kind === "session" && e.lastModel && (
            <span className={`bdg ${modelBadgeClass(e.lastModel)}`} title={e.lastModel}>
              {modelDisplayName(e.lastModel)}
            </span>
          )}
          <span className="timeline-time muted">
            {showDay ? `${fmtDay(e.ts)} ${fmtTime(e.ts)}` : fmtTime(e.ts)}
          </span>
          <span className="timeline-title">{e.title}</span>
          {e.worktreeName && (
            <span className="t-tag" title="워크트리 세션">
              ⑂ {e.worktreeName}
            </span>
          )}
          {activeTab === "all" && <span className="timeline-proj muted">{label(e)}</span>}
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
  };

  return (
    <div>
      <h2>Timeline</h2>
      {projectTabs.length > 0 && (
        <div className="tl-tabs">
          <button
            className={`tl-tab${activeTab === "all" ? " active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            전체 <span className="tl-tab-count">{totalShownCount}</span>
          </button>
          {projectTabs.map((t) => (
            <button
              key={t.key}
              className={`tl-tab${activeTab === t.key ? " active" : ""}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.status && <span className={`tl-tab-dot ${chipDotClass(t.status)}`} title={t.status} />}
              <span>{t.name}</span>
              <span className="tl-tab-count">{t.count}</span>
            </button>
          ))}
          {archivedProjects.length > 0 && (
            <div className="tl-archive-mgr-wrap" ref={archiveRef}>
              <button
                className={`tl-archive-mgr-btn${archiveOpen ? " open" : ""}`}
                onClick={() => setArchiveOpen((v) => !v)}
              >
                보관 {archivedProjects.length}개 관리
                <span className="tl-filter-caret">{archiveOpen ? "▾" : "▸"}</span>
              </button>
              {archiveOpen && (
                <div className="tl-filter-panel">
                  <div className="tl-filter-archive-list">
                    {archivedProjects.map((p) => (
                      <div key={p.id} className="tl-filter-archive-item">
                        <span className="tl-filter-name">{displayName(p)}</span>
                        <button onClick={() => setProjectStatus(p.id, "진행중")}>복원</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="timeline">
        {groups.length === 0 && <div className="muted tl-empty">표시할 활동이 없습니다.</div>}
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
                const children =
                  e.kind === "session" && e.sessionId ? childrenBySession.get(e.sessionId) : undefined;
                return (
                  <Fragment key={eventKey(e)}>
                    {renderRow(e, false)}
                    {children?.map((c) => renderRow(c, true, g.day))}
                  </Fragment>
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
