import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Link2, Pin, PinOff, Unplug } from "lucide-react";
import { api, fmtClock, fmtDay, fmtTime } from "../api/client";
import { renderMarkdownSafe } from "../markdown";
import type { ClaudeLiveTrackingStatus, LiveSession, ProviderFilter } from "@shared/provider-types";
import {
  STATUSES,
  buildProjNameMap,
  displayName,
  modelBadgeClass,
  modelDisplayName,
  projectVisibilityWrite,
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
  const [liveSessions, setLiveSessions] = useState<LiveSession[] | null>(null);
  const [liveTracking, setLiveTracking] = useState<ClaudeLiveTrackingStatus | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [hideMenu, setHideMenu] = useState<{ projectId: string; name: string; x: number; y: number } | null>(null);
  const [error, setError] = useState("");
  const [liveError, setLiveError] = useState("");
  const archiveRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);
  const providerQuery = `provider=${encodeURIComponent(providerFilter)}`;

  useEffect(() => {
    if (!archiveOpen && !hiddenOpen && !hideMenu) return;
    const onClick = (ev: MouseEvent) => {
      if (archiveRef.current && !archiveRef.current.contains(ev.target as Node)) setArchiveOpen(false);
      if (hiddenRef.current && !hiddenRef.current.contains(ev.target as Node)) setHiddenOpen(false);
      setHideMenu(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [archiveOpen, hiddenOpen, hideMenu]);

  const reload = () =>
    api
      .get<TimelineEvent[]>(`/api/workspace/timeline?${providerQuery}`)
      .then(setEvents)
      .catch((e) => setError(e.message));

  const reloadLiveSessions = () =>
    api
      .get<LiveSession[]>(`/api/workspace/live-sessions?${providerQuery}`)
      .then((sessions) => {
        setLiveSessions(sessions);
        setLiveError("");
      })
      .catch((e) => {
        setLiveSessions([]);
        setLiveError(e.message);
      });

  useEffect(() => {
    setEvents(null);
    setLiveSessions(null);
    setLiveTracking(null);
    setProjects([]);
    setActiveTab("all");
    setExpanded(new Set());
    setError("");
    reload();
    api
      .get<WorkspaceProject[]>(`/api/workspace/projects?${providerQuery}`)
      .then(setProjects)
      .catch(() => {});
    if (providerFilter !== "codex") {
      api.get<ClaudeLiveTrackingStatus>("/api/workspace/live-tracking/claude").then(setLiveTracking).catch(() => {});
    }
  }, [providerQuery]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (!alive || document.visibilityState !== "visible") return;
      void reloadLiveSessions();
    };
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
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
  const liveProjectLabel = (session: LiveSession) => {
    if (!session.projectId) return "프로젝트 없음";
    const grouped = projectByMemberId.get(session.projectId);
    return grouped ? displayName(grouped) : projName.get(session.projectId) ?? session.projectId;
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

  const hiddenProjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of projects) {
      if (!p.board.hidden) continue;
      ids.add(p.id);
      for (const memberId of p.memberIds ?? []) ids.add(memberId);
    }
    return ids;
  }, [projects]);

  const projectTabs = useMemo(() => {
    if (!events) return [];
    const counts = new Map<string, { name: string; count: number; status: BoardStatus | null }>();
    for (const e of events) {
      if (e.projectId && hiddenProjectIds.has(e.projectId)) continue;
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
  }, [events, projName, projStatusById, projLastActivityById, hiddenProjectIds]);

  useEffect(() => {
    if (activeTab === "all") return;
    if (!projectTabs.some((t) => t.key === activeTab)) setActiveTab("all");
  }, [projectTabs, activeTab]);

  const archivedProjects = useMemo(() => projects.filter((p) => p.board.status === "보관"), [projects]);
  const hiddenProjects = useMemo(() => projects.filter((p) => p.board.hidden), [projects]);

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

  async function patchPinned(e: TimelineEvent, pinned: boolean) {
    if (!e.sessionId) return;
    setEvents((prev) => (prev ? prev.map((x) => (sameEvent(x, e) ? { ...x, pinned } : x)) : prev));
    try {
      await api.post(`/api/workspace/board/session/${encodeURIComponent(e.sessionId)}`, { pinned });
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
      const req = projectVisibilityWrite(projects.find((p) => p.id === projectId), projectId, { status });
      await api.post(req.url, req.body);
    } catch (err) {
      setError((err as Error).message);
      api
        .get<WorkspaceProject[]>(`/api/workspace/projects?${providerQuery}`)
        .then(setProjects)
        .catch(() => {});
    }
  }

  async function setProjectHidden(projectId: string, hidden: boolean) {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, board: { ...p.board, hidden } } : p)),
    );
    if (hidden && activeTab === projectId) setActiveTab("all");
    try {
      const req = projectVisibilityWrite(projects.find((p) => p.id === projectId), projectId, { hidden });
      await api.post(req.url, req.body);
    } catch (err) {
      setError((err as Error).message);
      api
        .get<WorkspaceProject[]>(`/api/workspace/projects?${providerQuery}`)
        .then(setProjects)
        .catch(() => {});
    }
  }

  async function installClaudeTracking() {
    if (!window.confirm("Claude Code settings.json에 실시간 세션 추적 hook을 추가합니다.")) return;
    try {
      const status = await api.post<ClaudeLiveTrackingStatus>("/api/workspace/live-tracking/claude/install");
      setLiveTracking(status);
      setLiveError("");
    } catch (err) {
      setLiveError((err as Error).message);
    }
  }

  async function uninstallClaudeTracking() {
    if (!window.confirm("이 앱이 추가한 Claude 실시간 세션 추적 hook만 제거합니다.")) return;
    try {
      const status = await api.post<ClaudeLiveTrackingStatus>("/api/workspace/live-tracking/claude/uninstall");
      setLiveTracking(status);
      setLiveSessions((prev) => prev?.filter((session) => session.provider !== "claude") ?? prev);
      setLiveError("");
    } catch (err) {
      setLiveError((err as Error).message);
    }
  }

  if (error) return <div className="banner err">{error}</div>;
  if (!events) return <div className="muted">불러오는 중…</div>;
  if (events.length === 0 && liveSessions === null) return <div className="muted">불러오는 중…</div>;

  const shown = filterTimelineEventsForVisibleProjects(
    events.filter((e) => !(e.projectId && projStatusById.get(e.projectId) === "보관")),
    hiddenProjectIds,
    activeTab,
    projectKey,
  );

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
  const pinnedSessions = shown.filter(
    (e) => e.kind === "session" && e.pinned === true && isPinnableTimelineSession(e),
  );
  const pinnedSessionIds = new Set(pinnedSessions.map((e) => e.sessionId!));
  const runningSessionIds = new Set((liveSessions ?? []).map((session) => session.id));
  const unpinnedTopLevel = topLevel.filter(
    (e) => !(e.kind === "session" && e.sessionId && pinnedSessionIds.has(e.sessionId)),
  );

  const groups: { day: string; items: TimelineEvent[] }[] = [];
  for (const e of unpinnedTopLevel) {
    const day = fmtDay(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  const renderRow = (e: TimelineEvent, isChild: boolean, parentDay?: string, exactTimestamp = false) => {
    const key = eventKey(e);
    const isOpen = expanded.has(key);
    const showDay = isChild && parentDay !== undefined && fmtDay(e.ts) !== parentDay;
    const providerAccent = e.provider ? ` tl-provider-${e.provider}` : "";
    const modelBadge = e.kind === "session" ? timelineModelBadge(e) : null;
    const running = e.kind === "session" && !!e.sessionId && runningSessionIds.has(e.sessionId);
    return (
      <div className={`timeline-row${isChild ? " timeline-row-child" : ""}${providerAccent}`} key={key}>
        <div className="timeline-item" onClick={() => toggleExpand(key)}>
          {e.kind === "plan" && <span className="bdg bdg-plan">PLAN</span>}
          {modelBadge && (
            <span className={`bdg ${modelBadge.className}`} title={modelBadge.title}>
              {modelBadge.label}
            </span>
          )}
          {running && <span className="bdg bdg-live">RUNNING</span>}
          <span className="timeline-time muted">
            {exactTimestamp ? `${fmtDay(e.ts)} ${fmtClock(e.ts)}` : showDay ? `${fmtDay(e.ts)} ${fmtTime(e.ts)}` : fmtTime(e.ts)}
          </span>
          <span className="timeline-title">{e.title}</span>
          {e.kind === "session" && e.turnCount != null && e.turnCount > 0 && (
            <span className="t-tag">{e.turnCount}턴</span>
          )}
          {e.worktreeName && (
            <span className="t-tag" title="워크트리 세션">
              ⑂ {e.worktreeName}
            </span>
          )}
          {activeTab === "all" && <span className="timeline-proj muted">{label(e)}</span>}
          {isPinnableTimelineSession(e) && (
            <button
              className={`ws-icon-btn timeline-pin-btn${e.pinned ? " active" : ""}`}
              aria-label={e.pinned ? "세션 고정 해제" : "세션 고정"}
              title={e.pinned ? "세션 고정 해제" : "세션 고정"}
              onClick={(ev) => {
                ev.stopPropagation();
                void patchPinned(e, !e.pinned);
              }}
            >
              {e.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
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
      {providerFilter !== "codex" && liveTracking && !liveTracking.installed && (
        <div className="timeline-live-setup">
          <span>Claude 실시간 세션 추적</span>
          <button onClick={() => void installClaudeTracking()} title="Claude hook 연결">
            <Link2 size={14} /> 연결
          </button>
        </div>
      )}
      {providerFilter !== "codex" && liveTracking?.installed && (
        <div className="timeline-live-setup installed">
          <span>Claude 실시간 세션 추적 연결됨</span>
          <button onClick={() => void uninstallClaudeTracking()} title="Claude hook 연결 해제">
            <Unplug size={14} /> 해제
          </button>
        </div>
      )}
      {liveError && <div className="banner err">{liveError}</div>}
      {(projectTabs.length > 0 || archivedProjects.length > 0 || hiddenProjects.length > 0) && (
        <div className="tl-tabs">
          <button className={`tl-tab${activeTab === "all" ? " active" : ""}`} onClick={() => setActiveTab("all")}>
            전체 <span className="tl-tab-count">{totalShownCount}</span>
          </button>
          {projectTabs.map((t) => (
            <button
              key={t.key}
              className={`tl-tab${activeTab === t.key ? " active" : ""}`}
              onClick={() => setActiveTab(t.key)}
              onContextMenu={(ev) => {
                if (!canHideTimelineProjectTab(t.key)) return;
                ev.preventDefault();
                setHideMenu({ projectId: t.key, name: t.name, x: ev.clientX, y: ev.clientY });
              }}
              title="우클릭하면 프로젝트 숨김 메뉴가 열립니다"
            >
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
          {hiddenProjects.length > 0 && (
            <div className="tl-archive-mgr-wrap" ref={hiddenRef}>
              <button className={`tl-archive-mgr-btn${hiddenOpen ? " open" : ""}`} onClick={() => setHiddenOpen((v) => !v)}>
                숨김 {hiddenProjects.length}개 관리
                <span className="tl-filter-caret">{hiddenOpen ? "▾" : "▸"}</span>
              </button>
              {hiddenOpen && (
                <div className="tl-filter-panel">
                  <div className="tl-filter-archive-list">
                    {hiddenProjects.map((p) => (
                      <div key={p.id} className="tl-filter-archive-item">
                        <span className="tl-filter-name">{displayName(p)}</span>
                        <button onClick={() => setProjectHidden(p.id, false)}>숨김 해제</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {hideMenu && (
            <div
              className="tl-filter-panel"
              style={{ position: "fixed", left: hideMenu.x, top: hideMenu.y, zIndex: 80 }}
              onMouseDown={(ev) => ev.stopPropagation()}
            >
              <div className="tl-filter-archive-list">
                <div className="tl-filter-archive-item">
                  <span className="tl-filter-name">{hideMenu.name}</span>
                  <button
                    onClick={() => {
                      void setProjectHidden(hideMenu.projectId, true);
                      setHideMenu(null);
                    }}
                  >
                    프로젝트 숨기기
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {(liveSessions?.length ?? 0) > 0 && (
        <section className="timeline-live-section">
          <div className="timeline-live-head">
            <Activity size={14} aria-hidden="true" /> 실행 중 세션 <span className="cat-count">{liveSessions!.length}</span>
          </div>
          {liveSessions!.map((session) => {
            const timestamp = Date.parse(session.updatedAt ?? session.detectedAt);
            const modelBadge = session.model
              ? { label: modelDisplayName(session.model), className: modelBadgeClass(session.model), title: session.model }
              : { label: providerLabel(session.provider), className: `bdg-model-missing bdg-model-missing-${session.provider}`, title: "모델 정보 없음" };
            return (
              <div className={`timeline-row tl-provider-${session.provider}`} key={session.id}>
                <div className="timeline-item timeline-live-item">
                  <span className={`bdg ${modelBadge.className}`} title={modelBadge.title}>{modelBadge.label}</span>
                  <span className="bdg bdg-live">RUNNING</span>
                  <span className="timeline-time muted">{fmtDay(timestamp)} {fmtClock(timestamp)}</span>
                  <span className="timeline-title">{session.title}</span>
                  <span className="timeline-proj muted">{liveProjectLabel(session)}</span>
                </div>
              </div>
            );
          })}
        </section>
      )}
      {pinnedSessions.length > 0 && (
        <section className="timeline-pinned-section">
          <div className="timeline-pinned-head">
            <Pin size={14} aria-hidden="true" /> 고정 세션 <span className="cat-count">{pinnedSessions.length}</span>
          </div>
          {pinnedSessions.map((e) => {
            const children = e.sessionId ? childrenBySession.get(e.sessionId) : undefined;
            return (
              <Fragment key={eventKey(e)}>
                {renderRow(e, false, undefined, true)}
                {children?.map((child) => renderRow(child, true, fmtDay(e.ts)))}
              </Fragment>
            );
          })}
        </section>
      )}
      <div className="timeline">
        {groups.length === 0 && pinnedSessions.length === 0 && (liveSessions?.length ?? 0) === 0 && (
          <div className="muted tl-empty">표시할 활동이 없습니다.</div>
        )}
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

export function filterTimelineEventsForVisibleProjects(
  events: TimelineEvent[],
  hiddenProjectIds: Set<string>,
  activeTab: string,
  getProjectKey: (e: TimelineEvent) => string = (e) => e.projectId ?? NONE_KEY,
): TimelineEvent[] {
  return events.filter((e) => {
    if (e.projectId && hiddenProjectIds.has(e.projectId)) return false;
    if (activeTab === "all") return true;
    return getProjectKey(e) === activeTab;
  });
}

export function canHideTimelineProjectTab(tabKey: string): boolean {
  return tabKey !== "all" && tabKey !== NONE_KEY;
}

export function isPinnableTimelineSession(e: TimelineEvent): boolean {
  if (e.kind !== "session" || !e.sessionId) return false;
  if (e.provider === "codex") return e.sessionKind === "main";
  return e.sessionKind !== "worker" && e.sessionKind !== "imported" && e.sessionKind !== "system";
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
              __html: renderMarkdownSafe(e.lastAssistantSnippet, { breaks: true }),
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
      dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(body ?? "불러오는 중…") }}
    />
  );
}

function eventKey(e: TimelineEvent): string {
  return e.filename ?? e.sessionId ?? `${e.kind}-${e.ts}`;
}

function sameEvent(a: TimelineEvent, b: TimelineEvent): boolean {
  return eventKey(a) === eventKey(b);
}
