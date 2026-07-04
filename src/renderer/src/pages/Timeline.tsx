import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { api, fmtDay, fmtTime } from "../api/client";
import type {
  NormalizedProject,
  NormalizedTimelineEvent,
  ProviderFilter,
} from "@shared/provider-types";
import {
  STATUSES,
  buildProjNameMap,
  displayName,
  modelBadgeClass,
  modelDisplayName,
  providerBadgeClass,
  providerLabel,
  shortName,
  type BoardStatus,
  type TimelineEvent,
  type WorkspaceProject,
} from "./workspace-shared";

const NONE_KEY = "__none__";
const NORMALIZED_NONE_KEY = "__normalized-none__";

interface Props {
  providerFilter: ProviderFilter;
}

export default function Timeline({ providerFilter }: Props) {
  if (providerFilter === "claude") return <ClaudeTimeline />;
  return <ProviderTimeline providerFilter={providerFilter} />;
}

function ProviderTimeline({ providerFilter }: { providerFilter: Exclude<ProviderFilter, "claude"> }) {
  const [events, setEvents] = useState<NormalizedTimelineEvent[] | null>(null);
  const [projects, setProjects] = useState<NormalizedProject[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const providerQuery = `provider=${encodeURIComponent(providerFilter)}`;

  useEffect(() => {
    let alive = true;
    setError("");
    setEvents(null);
    setExpanded(new Set());
    api
      .get<NormalizedTimelineEvent[]>(`/api/workspace/normalized/timeline?${providerQuery}`)
      .then((data) => alive && setEvents(data))
      .catch((e) => alive && setError(e.message));
    api
      .get<NormalizedProject[]>(`/api/workspace/normalized/projects?${providerQuery}`)
      .then((data) => alive && setProjects(data))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [providerQuery]);

  const projectMap = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const projectTabs = useMemo(() => {
    if (!events) return [];
    const counts = new Map<string, { title: string; count: number }>();
    for (const event of events) {
      const key = event.projectId ?? NORMALIZED_NONE_KEY;
      const title = event.projectId
        ? projectMap.get(event.projectId)?.title ?? event.projectId
        : "연결 없는 항목";
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { title, count: 1 });
    }
    return [...counts.entries()].map(([key, value]) => ({ key, ...value }));
  }, [events, projectMap]);

  useEffect(() => {
    if (activeTab === "all") return;
    if (!projectTabs.some((tab) => tab.key === activeTab)) setActiveTab("all");
  }, [projectTabs, activeTab]);

  const shown = useMemo(() => {
    if (!events) return [];
    if (activeTab === "all") return events;
    return events.filter((event) => (event.projectId ?? NORMALIZED_NONE_KEY) === activeTab);
  }, [events, activeTab]);

  const groups = useMemo(() => {
    const next: { day: string; items: NormalizedTimelineEvent[] }[] = [];
    for (const event of shown) {
      const ts = Date.parse(event.updatedAt);
      const day = fmtDay(ts);
      const last = next[next.length - 1];
      if (last && last.day === day) last.items.push(event);
      else next.push({ day, items: [event] });
    }
    return next;
  }, [shown]);

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (error) return <div className="banner err">{error}</div>;
  if (!events) return <div className="muted">불러오는 중…</div>;

  const totalShownCount = projectTabs.reduce((sum, tab) => sum + tab.count, 0);

  return (
    <div>
      <h2>
        Timeline{" "}
        <span className={`provider-badge ${providerFilter !== "all" ? providerBadgeClass(providerFilter) : ""}`}>
          {providerFilter === "all" ? "All Providers" : providerLabel(providerFilter)}
        </span>
      </h2>
      <div className="banner warn provider-summary-note">
        통합 provider 타임라인은 Task 9 normalized summary를 사용합니다. Claude 전용 상태 편집/풍부한 계획 연동은 Claude 필터에서 그대로 유지됩니다.
      </div>
      {projectTabs.length > 0 && (
        <div className="tl-tabs">
          <button
            className={`tl-tab${activeTab === "all" ? " active" : ""}`}
            onClick={() => setActiveTab("all")}
          >
            전체 <span className="tl-tab-count">{totalShownCount}</span>
          </button>
          {projectTabs.map((tab) => (
            <button
              key={tab.key}
              className={`tl-tab${activeTab === tab.key ? " active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <span>{tab.title}</span>
              <span className="tl-tab-count">{tab.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="timeline">
        {groups.length === 0 && <div className="muted tl-empty">표시할 활동이 없습니다.</div>}
        {groups.map((group, index) => {
          const prev = groups[index - 1];
          const gapDays = prev
            ? Math.round((new Date(prev.day).getTime() - new Date(group.day).getTime()) / 86400000)
            : 0;
          return (
            <div key={group.day}>
              {gapDays > 1 && <div className="timeline-gap">· {gapDays - 1}일 공백 ·</div>}
              <div className="timeline-day">{group.day}</div>
              {group.items.map((event) => {
                const key = event.id;
                const open = expanded.has(key);
                const projectTitle = event.projectId ? projectMap.get(event.projectId)?.title ?? event.projectId : "연결 없음";
                return (
                  <div className="timeline-row" key={key}>
                    <div className="timeline-item" onClick={() => toggleExpand(key)}>
                      <span className={`provider-badge ${providerBadgeClass(event.provider)}`}>{providerLabel(event.provider)}</span>
                      <span className={`bdg bdg-${event.kind}`}>{event.kind.toUpperCase()}</span>
                      <span className="timeline-time muted">{fmtTime(Date.parse(event.updatedAt))}</span>
                      <span className="timeline-title">{event.title}</span>
                      {activeTab === "all" && <span className="timeline-proj muted">{projectTitle}</span>}
                      <span className="timeline-caret muted">{open ? "▾" : "▸"}</span>
                    </div>
                    {open && <NormalizedTimelineExpand event={event} />}
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

function NormalizedTimelineExpand({ event }: { event: NormalizedTimelineEvent }) {
  if (!event.lastUserText && !event.lastAssistantText && !event.sourcePath) {
    return <div className="timeline-expand muted">표시할 내용이 없습니다.</div>;
  }
  return (
    <div className="timeline-expand">
      {event.sourcePath && <div className="mono muted">{event.sourcePath}</div>}
      {event.lastUserText && (
        <p className="tl-prompt">
          <span className="ws-line-k">마지막 입력</span> {event.lastUserText}
        </p>
      )}
      {event.lastAssistantText && (
        <div>
          <span className="ws-line-k">마지막 응답</span>
          <div
            className="md-body ws-snippet-md"
            dangerouslySetInnerHTML={{
              __html: marked.parse(event.lastAssistantText, { breaks: true }) as string,
            }}
          />
        </div>
      )}
    </div>
  );
}

function ClaudeTimeline() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [error, setError] = useState("");
  const archiveRef = useRef<HTMLDivElement>(null);

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

  const projName = useMemo(() => buildProjNameMap(projects), [projects]);
  const label = (e: TimelineEvent) =>
    e.projectId ? projName.get(e.projectId) ?? shortName(e.realPath, e.projectId) : "";

  const projStatusById = useMemo(
    () => new Map<string, BoardStatus | null>(projects.map((p) => [p.id, p.board.status])),
    [projects],
  );

  const projLastActivityById = useMemo(
    () => new Map<string, number>(projects.map((p) => [p.id, p.lastActivity])),
    [projects],
  );

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

  useEffect(() => {
    if (activeTab === "all") return;
    if (!projectTabs.some((t) => t.key === activeTab)) setActiveTab("all");
  }, [projectTabs, activeTab]);

  const archivedProjects = useMemo(() => projects.filter((p) => p.board.status === "보관"), [projects]);

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const totalShownCount = projectTabs.reduce((sum, t) => sum + t.count, 0);

  async function patchStatus(e: TimelineEvent, status: BoardStatus) {
    setEvents((prev) => (prev ? prev.map((x) => (sameEvent(x, e) ? { ...x, status } : x)) : prev));
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

  const shown = events.filter((e) => {
    if (e.projectId && projStatusById.get(e.projectId) === "보관") return false;
    if (activeTab === "all") return true;
    return (e.projectId ?? NONE_KEY) === activeTab;
  });

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

  const groups: { day: string; items: TimelineEvent[] }[] = [];
  for (const e of topLevel) {
    const day = fmtDay(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

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
      <h2>
        Timeline <span className={`provider-badge ${providerBadgeClass("claude")}`}>{providerLabel("claude")}</span>
      </h2>
      {projectTabs.length > 0 && (
        <div className="tl-tabs">
          <button className={`tl-tab${activeTab === "all" ? " active" : ""}`} onClick={() => setActiveTab("all")}>
            전체 <span className="tl-tab-count">{totalShownCount}</span>
          </button>
          {projectTabs.map((t) => (
            <button key={t.key} className={`tl-tab${activeTab === t.key ? " active" : ""}`} onClick={() => setActiveTab(t.key)}>
              {t.status && <span className={`tl-tab-dot ${chipDotClass(t.status)}`} title={t.status} />}
              <span>{t.name}</span>
              <span className="tl-tab-count">{t.count}</span>
            </button>
          ))}
          {archivedProjects.length > 0 && (
            <div className="tl-archive-mgr-wrap" ref={archiveRef}>
              <button className={`tl-archive-mgr-btn${archiveOpen ? " open" : ""}`} onClick={() => setArchiveOpen((v) => !v)}>
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
            ? Math.round((new Date(prev.day).getTime() - new Date(g.day).getTime()) / 86400000)
            : 0;
          return (
            <div key={g.day}>
              {gapDays > 1 && <div className="timeline-gap">· {gapDays - 1}일 공백 ·</div>}
              <div className="timeline-day">{g.day}</div>
              {g.items.map((e) => {
                const children = e.kind === "session" && e.sessionId ? childrenBySession.get(e.sessionId) : undefined;
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

function chipDotClass(status: BoardStatus | null): string {
  return status ? `st-${STATUSES.indexOf(status)}` : "st-none";
}

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
        `/api/workspace/plan/content?filename=${encodeURIComponent(filename)}&archived=${archived ? 1 : 0}`,
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

function eventKey(e: TimelineEvent): string {
  return e.filename ?? e.sessionId ?? `${e.kind}-${e.ts}`;
}

function sameEvent(a: TimelineEvent, b: TimelineEvent): boolean {
  return eventKey(a) === eventKey(b);
}
