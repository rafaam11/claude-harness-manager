import type {
  NormalizedPlan,
  NormalizedProject,
  NormalizedSession,
  NormalizedTimelineEvent,
  ProviderFilter,
  ProviderId,
} from "@shared/provider-types";
import { getProviders } from "../providers/registry.js";
import { readBoard, type BoardStatus, type ProjectTrack } from "../lib/board.js";
import {
  getEnrichedPlans,
  getProjectSessions,
  getTimeline,
  getWorkspaceProjects,
  type EnrichedPlan,
  type SessionRecall,
  type TimelineEvent,
  type WorkspaceProject,
} from "./recall.js";

export function sortNormalizedProjects(projects: NormalizedProject[]): NormalizedProject[] {
  return [...projects].sort((a, b) => {
    const at = a.latestActivityAt ? Date.parse(a.latestActivityAt) : 0;
    const bt = b.latestActivityAt ? Date.parse(b.latestActivityAt) : 0;
    return bt - at;
  });
}

export function toTimelineEvents(
  sessions: NormalizedSession[],
  plans: NormalizedPlan[],
): NormalizedTimelineEvent[] {
  const events: NormalizedTimelineEvent[] = [];
  for (const s of sessions) {
    events.push({
      id: s.id,
      provider: s.provider,
      kind: "session",
      projectId: s.projectId ?? null,
      title: s.title ?? s.lastUserText ?? "(제목 없음)",
      updatedAt: s.updatedAt,
      sourcePath: s.sourcePath,
      lastUserText: s.lastUserText,
      lastAssistantText: s.lastAssistantText,
    });
  }
  for (const p of plans) {
    events.push({
      id: p.id,
      provider: p.provider,
      kind: "plan",
      projectId: p.projectId,
      title: p.title,
      updatedAt: p.updatedAt,
      sourcePath: p.sourcePath,
    });
  }
  return events.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getNormalizedWorkspaceProjects(
  filter: ProviderFilter = "all",
): Promise<NormalizedProject[]> {
  const projects = (await Promise.all(getProviders(filter).map((p) => p.listProjects()))).flat();
  return sortNormalizedProjects(projects);
}

export async function getNormalizedTimeline(
  filter: ProviderFilter = "all",
): Promise<NormalizedTimelineEvent[]> {
  const providers = getProviders(filter);
  const [sessions, plans] = await Promise.all([
    Promise.all(providers.map((p) => p.listSessions())),
    Promise.all(providers.map((p) => p.listPlans())),
  ]);
  return toTimelineEvents(sessions.flat(), plans.flat());
}

const EMPTY_BOARD: WorkspaceProject["board"] = {
  status: null,
  memo: "",
  nameOverride: "",
  tracks: [],
  hidden: false,
  order: null,
};

function normalizeBoard(entry: unknown): WorkspaceProject["board"] {
  const e = (entry && typeof entry === "object" ? entry : {}) as Partial<{
    status: BoardStatus | null;
    memo: string;
    nameOverride: string;
    tracks: ProjectTrack[];
    hidden: boolean;
    order: number | null;
  }>;
  return {
    status: e.status ?? null,
    memo: e.memo ?? "",
    nameOverride: e.nameOverride ?? "",
    tracks: Array.isArray(e.tracks) ? e.tracks : [],
    hidden: e.hidden ?? false,
    order: e.order ?? null,
  };
}

function normalizedSessionToRecall(session: NormalizedSession): SessionRecall {
  return {
    sessionId: session.id,
    aiTitle: session.title ?? null,
    lastPrompt: session.lastUserText ?? null,
    lastAssistantSnippet: session.lastAssistantText ?? null,
    cwd: session.cwd ?? null,
    gitBranch: null,
    lastModel: session.model ?? null,
    transcriptPath: session.sourcePath ?? session.id,
    transcriptMtime: Date.parse(session.updatedAt),
    truncatedScan: true,
  };
}

async function codexWorkspaceProjects(): Promise<WorkspaceProject[]> {
  const provider = getProviders("codex")[0];
  const [projects, sessions, board] = await Promise.all([
    provider.listProjects(),
    provider.listSessions(),
    readBoard(),
  ]);
  const latestByProject = new Map<string, NormalizedSession>();
  for (const session of sessions) {
    if (!session.projectId) continue;
    const prev = latestByProject.get(session.projectId);
    if (!prev || Date.parse(session.updatedAt) > Date.parse(prev.updatedAt)) {
      latestByProject.set(session.projectId, session);
    }
  }
  return projects.map((project) => {
    const latest = latestByProject.get(project.id);
    const lastActivity = project.latestActivityAt ? Date.parse(project.latestActivityAt) : 0;
    return {
      id: project.id,
      provider: "codex" as ProviderId,
      realPath: project.realPath,
      gitBranch: null,
      lastActivity,
      staleDays: lastActivity ? Math.max(0, Math.floor((Date.now() - lastActivity) / 86_400_000)) : 0,
      recall: latest ? normalizedSessionToRecall(latest) : null,
      todos: null,
      board: normalizeBoard(board.projects[project.id] ?? EMPTY_BOARD),
      repoRoot: project.realPath,
      isWorktree: false,
      worktreeName: null,
      worktrees: [],
      memberIds: [project.id],
    };
  });
}

export async function getProviderWorkspaceProjects(
  filter: ProviderFilter = "all",
): Promise<WorkspaceProject[]> {
  const lists: WorkspaceProject[][] = [];
  if (filter === "all" || filter === "claude") {
    lists.push((await getWorkspaceProjects()).map((p) => ({ ...p, provider: "claude" as const })));
  }
  if (filter === "all" || filter === "codex") lists.push(await codexWorkspaceProjects());
  return lists.flat().sort((a, b) => b.lastActivity - a.lastActivity);
}

export async function getProviderProjectSessions(projectId: string): Promise<SessionRecall[]> {
  if (projectId.startsWith("codex:")) {
    const provider = getProviders("codex")[0];
    return (await provider.listSessions())
      .filter((session) => session.projectId === projectId)
      .map(normalizedSessionToRecall)
      .sort((a, b) => b.transcriptMtime - a.transcriptMtime);
  }
  return getProjectSessions(projectId);
}

export async function getProviderEnrichedPlans(
  archived: boolean,
  filter: ProviderFilter = "claude",
): Promise<EnrichedPlan[]> {
  if (filter === "codex") return [];
  return (await getEnrichedPlans(archived)).map((plan) => ({ ...plan, provider: "claude" as const }));
}

function codexSessionToTimelineEvent(session: NormalizedSession): TimelineEvent {
  return {
    ts: Date.parse(session.updatedAt),
    kind: "session",
    projectId: session.projectId ?? null,
    realPath: session.cwd ?? null,
    title: session.title ?? session.lastUserText ?? "(제목 없음)",
    sessionId: session.id,
    status: "진행중",
    lastPrompt: session.lastUserText ?? null,
    lastAssistantSnippet: session.lastAssistantText ?? null,
    lastModel: session.model ?? null,
    provider: "codex",
  };
}

export async function getProviderTimeline(
  archived: boolean,
  filter: ProviderFilter = "claude",
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  if (filter === "all" || filter === "claude") {
    events.push(...(await getTimeline(archived)).map((event) => ({ ...event, provider: "claude" as const })));
  }
  if (filter === "all" || filter === "codex") {
    const provider = getProviders("codex")[0];
    events.push(...(await provider.listSessions()).map(codexSessionToTimelineEvent));
  }
  return events.sort((a, b) => b.ts - a.ts);
}
