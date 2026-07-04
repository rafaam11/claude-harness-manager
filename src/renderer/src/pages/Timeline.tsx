import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { api, fmtDay, fmtTime } from "../api/client";
import type { ProviderFilter } from "@shared/provider-types";
import {
  STATUSES,
  buildProjNameMap,
  displayName,
  modelBadgeClass,
  modelDisplayName,
  providerLabel,
  shortName,
  type BoardStatus,
  type TimelineEvent,
  type WorkspaceProject,
} from "./workspace-shared";

const NONE_KEY = "__none__";
interface Props {
  providerFilter: ProviderFilter;
}

export default function Timeline({ providerFilter }: Props) {
  return <ClaudeTimeline providerFilter={providerFilter} />;
}

function ClaudeTimeline({ providerFilter }: { providerFilter: ProviderFilter }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [error, setError] = useState("");
  const archiveRef = useRef<HTMLDivElement>(null);
  const providerQuery = `provider=${encodeURIComponent(providerFilter)}`;

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
      .get<TimelineEvent[]>(`/api/workspace/timeline?${providerQuery}`)
      .then(setEvents)
      .catch((e) => setError(e.message));

  useEffect(() => {
    setEvents(null);
    setProjects([]);
    setActiveTab("all");
    setExpanded(new Set());
    setError("");
    reload();
    api
      .get<WorkspaceProject[]>(`/api/workspace/projects?${providerQuery}`)
      .then(setProjects)
      .catch(() => {});
  }, [providerQuery]);

  const projName = useMemo(() => buildProjNameMap(projects), [projects]);
  const projectByMemberId = useMemo(() => {
    const m = new Map<string, WorkspaceProject>();
    for (const p of projects) {
      m.set(p.id, p);
      for (const memberId of p.memberIds ?? []) m.set(memberId, p);
    }
    return m;
  }, [projects]);
  const projectKey = (e: TimelineEvent) =>
    e.projectId ? projectByMemberId.get(e.projectId)?.id ?? e.projectId : NONE_KEY;
  const label = (e: TimelineEvent) => {
    if (!e.projectId) return "";
    const grouped = projectByMemberId.get(e.projectId);
    return grouped ? displayName(grouped) : projName.get(e.projectId) ?? shortName(e.realPath, e.projectId);
  };

  const projStatusById = useMemo(
    () => {
      const m = new Map<string, BoardStatus | null>();
      for (const p of projects) {
        m.set(p.id, p.board.status);
        for (const memberId of p.memberIds ?? []) m.set(memberId, p.board.status);
      }
      return m;
    },
    [projects],
  );

  const projLastActivityById = useMemo(
    () => {
      const m = new Map<string, number>();
      for (const p of projects) {
        m.set(p.id, p.lastActivity);
        for (const memberId of p.memberIds ?? []) m.set(memberId, p.lastActivity);
      }
      return m;
    },
    [projects],
  );

  const projectTabs = useMemo(() => {
    if (!events) return [];
    const counts = new Map<string, { name: string; count: number; status: BoardStatus | null }>();
    for (const e of events) {
      const status = e.projectId ? projStatusById.get(e.projectId) ?? null : null;
      if (status === "보관") continue;
      const key = projectKey(e);
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
        .get<WorkspaceProject[]>(`/api/workspace/projects?${providerQuery}`)
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
    return projectKey(e) === activeTab;
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
  const topLevel = shown.filter((e) => isTopLevelTimelineEvent(e, visibleSessionIds));

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
    const providerAccent = e.provider ? ` tl-provider-${e.provider}` : "";
    const modelBadge = e.kind === "session" ? timelineModelBadge(e) : null;
    return (
      <div className={`timeline-row${isChild ? " timeline-row-child" : ""}${providerAccent}`} key={key}>
        <div className="timeline-item" onClick={() => toggleExpand(key)}>
          {e.kind === "plan" && <span className="bdg bdg-plan">PLAN</span>}
          {modelBadge && (
            <span className={`bdg ${modelBadge.className}`} title={modelBadge.title}>
              {modelBadge.label}
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

export function isTopLevelTimelineEvent(e: TimelineEvent, visibleSessionIds: Set<string>): boolean {
  if (e.kind !== "plan") return true;
  if (!e.parentSessionId) return false;
  return !visibleSessionIds.has(e.parentSessionId);
}

export function timelineModelBadge(e: TimelineEvent): { label: string; className: string; title: string } {
  if (e.lastModel) {
    return {
      label: modelDisplayName(e.lastModel),
      className: modelBadgeClass(e.lastModel),
      title: e.lastModel,
    };
  }
  if (e.provider) {
    return {
      label: providerLabel(e.provider),
      className: `bdg-model-missing bdg-model-missing-${e.provider}`,
      title: "모델 정보 없음",
    };
  }
  return { label: "Model ?", className: "bdg-model-missing", title: "모델 정보 없음" };
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
