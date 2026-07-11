import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Link2, Pin, PinOff, Unplug } from "lucide-react";
import { api, fmtClock, fmtDay, fmtTime } from "../api/client";
import { renderMarkdownSafe } from "../markdown";
import type {
  ClaudeLiveTrackingStatus,
  LiveActivityState,
  LiveSession,
  ProviderFilter,
} from "@shared/provider-types";
import {
  STATUSES,
  buildProjNameMap,
  displayName,
  modelBadgeClass,
  modelDisplayName,
  projectTone,
  projectVisibilityWrite,
  providerLabel,
  shortName,
  type BoardStatus,
  type TimelineEvent,
  type WorkspaceProject,
} from "./workspace-shared";
import SessionTranscriptModal, { type SessionModalTarget } from "./SessionTranscriptModal";

export const NONE_KEY = "__none__";
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
  const [modalTarget, setModalTarget] = useState<SessionModalTarget | null>(null);
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
  const liveProjectKey = (session: LiveSession) =>
    session.projectId ? projectByMemberId.get(session.projectId)?.id ?? session.projectId : NONE_KEY;
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
  const liveBySessionId = new Map((liveSessions ?? []).map((session) => [session.id, session]));
  const unpinnedTopLevel = topLevel.filter(
    (e) => !(e.kind === "session" && e.sessionId && pinnedSessionIds.has(e.sessionId)),
  );

  // "전체" 탭에서만 프로젝트로 한 번 더 접는다(프로젝트 탭은 이미 한 프로젝트뿐이라 헤더가 소음이다).
  const groupByProject = activeTab === "all";
  const days = groupTimelineByDayAndProject(unpinnedTopLevel, projectKey, (e) => label(e) || "프로젝트 없음", fmtDay);

  const renderRow = (
    e: TimelineEvent,
    isChild: boolean,
    parentDay?: string,
    exactTimestamp = false,
    showProject = false,
  ) => {
    const key = eventKey(e);
    const isOpen = expanded.has(key);
    const showDay = isChild && parentDay !== undefined && fmtDay(e.ts) !== parentDay;
    const providerAccent = e.provider ? ` tl-provider-${e.provider}` : "";
    const modelBadge = e.kind === "session" ? timelineModelBadge(e) : null;
    const live = e.kind === "session" && e.sessionId ? liveBySessionId.get(e.sessionId) : undefined;
    return (
      <div className={`timeline-row${isChild ? " timeline-row-child" : ""}${providerAccent}`} key={key}>
        <div
          className="timeline-item"
          onClick={() => {
            // 세션은 팝업으로 전체 대화, 계획은 기존 인라인 본문 펼침.
            if (e.kind === "session") {
              if (e.sessionId) setModalTarget({ sessionId: e.sessionId, title: e.title });
            } else {
              toggleExpand(key);
            }
          }}
        >
          {e.kind === "plan" && <span className="bdg bdg-plan">PLAN</span>}
          {modelBadge && (
            <span className={`bdg ${modelBadge.className}`} title={modelBadge.title}>
              {modelBadge.label}
            </span>
          )}
          {live && <ActivityBadge state={live.activity.state} />}
          <span className="timeline-time muted">
            {exactTimestamp ? `${fmtDay(e.ts)} ${fmtClock(e.ts)}` : showDay ? `${fmtDay(e.ts)} ${fmtTime(e.ts)}` : fmtTime(e.ts)}
          </span>
          {showProject && e.projectId && (
            <ProjectChip name={label(e) || "프로젝트 없음"} toneKey={projectKey(e)} />
          )}
          <span className="timeline-title">{e.title}</span>
          {e.kind === "session" && e.turnCount != null && e.turnCount > 0 && (
            <span className="t-tag">{e.turnCount}턴</span>
          )}
          {e.worktreeName && (
            <span className="t-tag" title="워크트리 세션">
              ⑂ {e.worktreeName}
            </span>
          )}
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
          {e.kind === "plan" && <span className="timeline-caret muted">{isOpen ? "▾" : "▸"}</span>}
        </div>
        {isOpen && e.kind === "plan" && e.filename && (
          <PlanBody filename={e.filename} archived={!!e.archived} />
        )}
      </div>
    );
  };

  const renderRowWithChildren = (e: TimelineEvent, day: string, exactTimestamp = false, showProject = false) => {
    const children = e.kind === "session" && e.sessionId ? childrenBySession.get(e.sessionId) : undefined;
    return (
      <Fragment key={eventKey(e)}>
        {renderRow(e, false, undefined, exactTimestamp, showProject)}
        {children?.map((child) => renderRow(child, true, day))}
      </Fragment>
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
          <span>
            {liveTracking.outdated
              ? "Claude 실시간 세션 추적이 예전 방식으로 연결돼 있습니다 — 업데이트하면 이미 실행 중인 세션도 잡힙니다"
              : "Claude 실시간 세션 추적 연결됨"}
          </span>
          {liveTracking.outdated && (
            <button onClick={() => void installClaudeTracking()} title="Claude hook 업데이트">
              <Link2 size={14} /> 업데이트
            </button>
          )}
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
          {liveSessions!.map((session) => (
            <LiveSessionRow
              key={session.id}
              session={session}
              projectName={liveProjectLabel(session)}
              projectKey={liveProjectKey(session)}
              onOpen={() =>
                setModalTarget({ sessionId: session.id, title: session.title, todos: session.todos })
              }
            />
          ))}
        </section>
      )}
      {pinnedSessions.length > 0 && (
        <section className="timeline-pinned-section">
          <div className="timeline-pinned-head">
            <Pin size={14} aria-hidden="true" /> 고정 세션 <span className="cat-count">{pinnedSessions.length}</span>
          </div>
          {pinnedSessions.map((e) => renderRowWithChildren(e, fmtDay(e.ts), true, true))}
        </section>
      )}
      <div className="timeline">
        {days.length === 0 && pinnedSessions.length === 0 && (liveSessions?.length ?? 0) === 0 && (
          <div className="muted tl-empty">표시할 활동이 없습니다.</div>
        )}
        {days.map((g, i) => {
          const prev = days[i - 1];
          const gapDays = prev
            ? Math.round((new Date(prev.day).getTime() - new Date(g.day).getTime()) / 86400000)
            : 0;
          return (
            <div key={g.day}>
              {gapDays > 1 && <div className="timeline-gap">· {gapDays - 1}일 공백 ·</div>}
              <div className="timeline-day">{g.day}</div>
              {groupByProject
                ? g.projects.map((p) => (
                    <div className="tl-proj-group" key={p.key}>
                      <div
                        className={`tl-proj-head ${p.tone}`}
                        role="button"
                        tabIndex={0}
                        title="클릭하면 이 프로젝트만 봅니다"
                        onClick={() => canHideTimelineProjectTab(p.key) && setActiveTab(p.key)}
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter" && canHideTimelineProjectTab(p.key)) setActiveTab(p.key);
                        }}
                        onContextMenu={(ev) => {
                          if (!canHideTimelineProjectTab(p.key)) return;
                          ev.preventDefault();
                          setHideMenu({ projectId: p.key, name: p.name, x: ev.clientX, y: ev.clientY });
                        }}
                      >
                        <span className="tl-tone-dot" aria-hidden="true" />
                        <span className="tl-proj-name">{p.name}</span>
                        <span className="tl-tab-count">{p.items.length}건</span>
                      </div>
                      {p.items.map((e) => renderRowWithChildren(e, g.day))}
                    </div>
                  ))
                : g.projects.flatMap((p) => p.items).map((e) => renderRowWithChildren(e, g.day))}
            </div>
          );
        })}
      </div>
      <SessionTranscriptModal target={modalTarget} onClose={() => setModalTarget(null)} />
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

export interface TimelineProjectGroup {
  key: string;
  name: string;
  tone: string;
  items: TimelineEvent[];
}
export interface TimelineDayGroup {
  day: string;
  projects: TimelineProjectGroup[];
}

/**
 * 날짜 → 프로젝트 2단 그룹. events는 최신순이어야 한다(그래야 각 그룹의 첫 항목이 그 그룹의 최신 활동).
 * "프로젝트 없음"은 하루 안에서 언제나 맨 뒤로 민다.
 */
export function groupTimelineByDayAndProject(
  events: TimelineEvent[],
  getProjectKey: (e: TimelineEvent) => string,
  getProjectName: (e: TimelineEvent) => string,
  getDay: (ts: number) => string,
): TimelineDayGroup[] {
  const days: TimelineDayGroup[] = [];
  for (const e of events) {
    const day = getDay(e.ts);
    let dayGroup = days[days.length - 1];
    if (!dayGroup || dayGroup.day !== day) {
      dayGroup = { day, projects: [] };
      days.push(dayGroup);
    }
    const key = getProjectKey(e);
    let group = dayGroup.projects.find((p) => p.key === key);
    if (!group) {
      group = { key, name: getProjectName(e), tone: projectTone(key), items: [] };
      dayGroup.projects.push(group);
    }
    group.items.push(e);
  }
  for (const day of days) {
    day.projects.sort((a, b) => {
      if (a.key === NONE_KEY) return 1;
      if (b.key === NONE_KEY) return -1;
      return b.items[0].ts - a.items[0].ts;
    });
  }
  return days;
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

// --- 실행 중 세션 ---

const ACTIVITY_META: Record<LiveActivityState, { label: string; className: string }> = {
  working: { label: "작업 중", className: "bdg-act-working" },
  idle: { label: "대기 중", className: "bdg-act-idle" },
  "awaiting-approval": { label: "계획 승인 대기", className: "bdg-act-await" },
  "awaiting-input": { label: "질문 대기", className: "bdg-act-await" },
  unknown: { label: "RUNNING", className: "bdg-live" },
};

export function activityDetailText(session: LiveSession): string | null {
  switch (session.activity.state) {
    case "awaiting-approval":
      return "계획을 제출하고 승인을 기다리는 중";
    case "awaiting-input":
      return "질문을 던지고 답을 기다리는 중";
    case "idle":
      return "응답을 마치고 다음 지시를 기다리는 중";
    case "working":
      return session.activity.tool ? `${session.activity.tool} 실행 중` : "응답 생성 중";
    default:
      return null;
  }
}

/** "4분째" — 상태가 얼마나 지속되고 있는지. 승인 대기가 길어지는 걸 눈치채라고 있는 값이다. */
export function elapsedLabel(since: string | null, now = Date.now()): string | null {
  if (!since) return null;
  const started = Date.parse(since);
  if (!Number.isFinite(started)) return null;
  const seconds = Math.max(0, Math.round((now - started) / 1000));
  if (seconds < 60) return `${seconds}초째`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분째`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분째`;
}

function ActivityBadge({ state }: { state: LiveActivityState }) {
  const meta = ACTIVITY_META[state] ?? ACTIVITY_META.unknown;
  return <span className={`bdg ${meta.className}`}>{meta.label}</span>;
}

function ProjectChip({ name, toneKey }: { name: string; toneKey: string }) {
  return (
    <span className={`timeline-proj-chip ${projectTone(toneKey)}`} title={name}>
      <span className="tl-tone-dot" aria-hidden="true" />
      {name}
    </span>
  );
}

function LiveSessionRow({
  session,
  projectName,
  projectKey,
  onOpen,
}: {
  session: LiveSession;
  projectName: string;
  projectKey: string;
  onOpen: () => void;
}) {
  // 경과 시간이 계속 흐르도록 초 단위로 다시 그린다(폴링 응답은 상태가 안 바뀌면 동일하다).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const modelBadge = session.model
    ? { label: modelDisplayName(session.model), className: modelBadgeClass(session.model), title: session.model }
    : {
        label: providerLabel(session.provider),
        className: `bdg-model-missing bdg-model-missing-${session.provider}`,
        title: "모델 정보 없음",
      };
  const elapsed = elapsedLabel(session.activity.since, now);
  const detail = activityDetailText(session);
  const todos = session.todos;

  return (
    <div className={`timeline-row tl-provider-${session.provider}`}>
      <div className="timeline-item timeline-live-item" onClick={onOpen}>
        <div className="tl-live-body">
          <div className="tl-live-line">
            <ActivityBadge state={session.activity.state} />
            {elapsed && <span className="muted tl-live-since">{elapsed}</span>}
            <ProjectChip name={projectName} toneKey={projectKey} />
          </div>
          <div className="tl-live-line">
            <span className={`bdg ${modelBadge.className}`} title={modelBadge.title}>
              {modelBadge.label}
            </span>
            <span className="timeline-title">{session.title}</span>
          </div>
          {(detail || todos) && (
            <div className="tl-live-sub muted">
              ↳ {detail}
              {todos && ` · 할 일 ${todos.done}/${todos.total}`}
              {todos?.active && ` · “${todos.active}”`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function chipDotClass(status: BoardStatus | null): string {
  return status ? `st-${STATUSES.indexOf(status)}` : "st-none";
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
