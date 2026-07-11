import type {
  NormalizedPlan,
  NormalizedProject,
  NormalizedSession,
  NormalizedTimelineEvent,
  ProviderFilter,
  ProviderId,
} from "@shared/provider-types";
import { getProviders, splitEntityId } from "../providers/registry.js";
import { readBoard, type BoardData, type BoardStatus, type ProjectTrack } from "../lib/board.js";
import {
  findProjectRegistryProject,
  migrateBoardProjectsToRegistry,
  projectRegistryNeedsReconciliation,
  readBoardWithProjectRegistry,
  readProjectRegistry,
  type DiscoveredProject,
  type ProjectRegistryV1,
} from "../lib/project-registry.js";
import { normalizePathKey } from "../lib/path-normalize.js";
import { parseTimeMs } from "../lib/time.js";
import {
  getEnrichedPlans,
  getPinnedProjectSessions,
  getProjectSessions,
  getTimeline,
  getWorkspaceProjects,
  type EnrichedPlan,
  type SessionRecall,
  type TimelineEvent,
  type WorkspaceProject,
} from "./recall.js";
import { guessOriginalPath } from "./projects.js";

type ProviderWorkspaceProject = WorkspaceProject & { provider?: ProviderId };

export function applyProjectRegistryMetadata(
  projects: readonly ProviderWorkspaceProject[],
  registry: ProjectRegistryV1,
): ProviderWorkspaceProject[] {
  return projects.map((project) => {
    const shared = findProjectRegistryProject(
      registry,
      [project.id, ...(project.memberIds ?? [])],
      project.repoRoot ?? project.realPath,
    );
    if (!shared) return project;
    return {
      ...project,
      registryId: shared.id,
      board: {
        status: shared.status,
        memo: shared.memo,
        nameOverride: shared.displayName ?? "",
        tracks: structuredClone(shared.tracks),
        hidden: shared.hidden,
        order: shared.order,
      },
    };
  });
}

export function collectProjectRegistryDiscoveries(
  projects: readonly ProviderWorkspaceProject[],
): DiscoveredProject[] {
  const discoveries: DiscoveredProject[] = [];
  const seen = new Set<string>();
  for (const project of projects) {
    if (!project.provider) continue;
    const rootPath = project.repoRoot ?? project.realPath;
    if (!rootPath) continue;
    const identifiers = project.memberIds?.length ? project.memberIds : [project.id];
    for (const identifier of identifiers) {
      const split = splitEntityId(identifier);
      const providerRef = project.provider === "claude" ? split.localId : `codex:${split.localId}`;
      const key = `${project.provider}\0${providerRef}\0${normalizePathKey(rootPath)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      discoveries.push({ rootPath, source: project.provider, providerRef });
    }
  }
  return discoveries;
}

function collectLegacyBoardDiscoveries(board: BoardData): DiscoveredProject[] {
  const discoveries: DiscoveredProject[] = [];
  for (const [identifier, entry] of Object.entries(board.projects)) {
    const split = splitEntityId(identifier);
    const rootPath = entry.repoPath ?? guessOriginalPath(split.localId);
    if (!rootPath) continue;
    discoveries.push({
      rootPath,
      source: split.provider,
      providerRef: split.provider === "claude" ? split.localId : `codex:${split.localId}`,
    });
  }
  return discoveries;
}

export function sortNormalizedProjects(projects: NormalizedProject[]): NormalizedProject[] {
  return [...projects].sort((a, b) => {
    return parseTimeMs(b.latestActivityAt) - parseTimeMs(a.latestActivityAt);
  });
}

function pathGroupKey(project: Pick<WorkspaceProject, "realPath" | "repoRoot" | "id">): string {
  const p = project.realPath ?? project.repoRoot;
  if (!p) return `id:${project.id}`;
  return `path:${normalizePathKey(p)}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

// 상태의 "아카이브 정도"(작을수록 활성). 병합 카드 status 계산에 쓴다.
const STATUS_ARCHIVE_RANK: Record<BoardStatus, number> = { 진행중: 0, 보류: 1, 완료: 2, 보관: 3 };

/**
 * 여러 provider 프로젝트를 한 repo 카드로 접을 때 대표 status를 고른다.
 * 가장 덜 아카이브된(가장 활성) 멤버 기준 — 한쪽이 보관이어도 다른 쪽이 활성이면 활성으로 본다.
 * 미지정(null)은 활성으로 취급하되, 동순위면 명시 상태를 선호해 정보를 보존한다.
 */
function leastArchivedStatus(statuses: (BoardStatus | null)[]): BoardStatus | null {
  let best: BoardStatus | null = null;
  let bestRank = Infinity;
  for (const s of statuses) {
    const rank = s == null ? 0 : STATUS_ARCHIVE_RANK[s];
    if (rank < bestRank || (rank === bestRank && best == null && s != null)) {
      bestRank = rank;
      best = s;
    }
  }
  return best;
}

export function mergeProviderProjectsByPath(
  projects: ProviderWorkspaceProject[],
): ProviderWorkspaceProject[] {
  const groups = new Map<string, ProviderWorkspaceProject[]>();
  for (const project of projects) {
    const key = pathGroupKey(project);
    const arr = groups.get(key) ?? [];
    arr.push(project);
    groups.set(key, arr);
  }

  const merged: ProviderWorkspaceProject[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => b.lastActivity - a.lastActivity);
    const primary = sorted[0];
    const boardSources = [...group].sort((a, b) => {
      const providerRank = (provider: ProviderId | undefined) =>
        provider === "claude" ? 0 : provider === "codex" ? 1 : 2;
      return providerRank(a.provider) - providerRank(b.provider) || a.id.localeCompare(b.id);
    });
    const firstText = (pick: (p: ProviderWorkspaceProject) => string) =>
      boardSources.map(pick).find((value) => value.length > 0) ?? "";
    const firstTracks =
      boardSources.map((project) => project.board.tracks).find((tracks) => tracks.length > 0) ?? [];
    const firstOrder =
      boardSources.map((project) => project.board.order).find((order) => order != null) ?? null;
    const memberIds = uniqueStrings(sorted.flatMap((p) => [p.id, ...(p.memberIds ?? [])]));
    const providers = new Set(sorted.map((p) => p.provider).filter(Boolean));
    merged.push({
      ...primary,
      provider: providers.size === 1 ? primary.provider : undefined,
      memberIds,
      worktrees: sorted.flatMap((p) => p.worktrees ?? []),
      lastActivity: Math.max(...sorted.map((p) => p.lastActivity)),
      staleDays: Math.min(...sorted.map((p) => p.staleDays)),
      board: {
        // 수동 필드는 안정적인 provider 순서로 보존하고, hidden/status는 모든 멤버를 함께 본다.
        ...primary.board,
        memo: firstText((project) => project.board.memo),
        nameOverride: firstText((project) => project.board.nameOverride),
        tracks: firstTracks,
        order: firstOrder,
        hidden: sorted.every((p) => p.board.hidden),
        status: leastArchivedStatus(sorted.map((p) => p.board.status)),
      },
    });
  }
  return merged.sort((a, b) => b.lastActivity - a.lastActivity);
}

export function toTimelineEvents(
  sessions: NormalizedSession[],
  plans: NormalizedPlan[],
  board?: BoardData,
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
      startedAt: s.startedAt,
      turnCount: s.turnCount,
      pinned: board?.sessions[s.id]?.pinned === true,
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
  return events.sort((a, b) => parseTimeMs(b.updatedAt) - parseTimeMs(a.updatedAt));
}

export function filterUserFacingSessions(sessions: NormalizedSession[]): NormalizedSession[] {
  return sessions.filter((session) => session.provider !== "codex" || session.sessionKind === "main");
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
  return toTimelineEvents(
    filterUserFacingSessions(sessions.flat()),
    plans.flat(),
    await readBoardWithProjectRegistry(),
  );
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

function normalizedSessionToRecall(session: NormalizedSession, board?: BoardData): SessionRecall {
  return {
    sessionId: session.id,
    sessionKind: session.sessionKind,
    aiTitle: session.title ?? null,
    lastPrompt: session.lastUserText ?? null,
    lastAssistantSnippet: session.lastAssistantText ?? null,
    cwd: session.cwd ?? null,
    gitBranch: null,
    lastModel: session.model ?? null,
    transcriptPath: session.sourcePath ?? session.id,
    transcriptMtime: parseTimeMs(session.updatedAt),
    truncatedScan: true,
    startedAt: session.startedAt ? parseTimeMs(session.startedAt) : null,
    turnCount: session.turnCount ?? null,
    pinned: board?.sessions[session.id]?.pinned === true,
  };
}

async function codexWorkspaceProjects(): Promise<WorkspaceProject[]> {
  const provider = getProviders("codex")[0];
  const [sessions, board] = await Promise.all([provider.listSessions(), readBoardWithProjectRegistry()]);
  const projects = new Map<string, { id: string; realPath: string | null }>();
  for (const session of sessions) {
    if (!session.projectId) continue;
    const prev = projects.get(session.projectId);
    projects.set(session.projectId, {
      id: session.projectId,
      realPath: session.cwd ?? prev?.realPath ?? null,
    });
  }
  const latestByProject = new Map<string, NormalizedSession>();
  for (const session of filterUserFacingSessions(sessions)) {
    if (!session.projectId) continue;
    const prev = latestByProject.get(session.projectId);
    if (!prev || parseTimeMs(session.updatedAt) > parseTimeMs(prev.updatedAt)) {
      latestByProject.set(session.projectId, session);
    }
  }
  return [...projects.values()].map((project) => {
    const latest = latestByProject.get(project.id);
    const lastActivity = latest ? parseTimeMs(latest.updatedAt) : 0;
    return {
      id: project.id,
      provider: "codex" as ProviderId,
      realPath: project.realPath,
      gitBranch: null,
      lastActivity,
      staleDays: lastActivity ? Math.max(0, Math.floor((Date.now() - lastActivity) / 86_400_000)) : 0,
      recall: latest ? normalizedSessionToRecall(latest, board) : null,
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
  let registry: ProjectRegistryV1 | null;
  try {
    registry = await readProjectRegistry();
  } catch {
    registry = null;
  }
  const needsMigration = registry !== null && !registry.migratedFromBoardAt;
  const loadClaude = needsMigration || filter === "all" || filter === "claude";
  const loadCodex = needsMigration || filter === "all" || filter === "codex";
  const [claudeProjects, codexProjects] = await Promise.all([
    loadClaude
      ? getWorkspaceProjects().then((projects) =>
          projects.map((project) => ({ ...project, provider: "claude" as const })),
        )
      : Promise.resolve([]),
    loadCodex ? codexWorkspaceProjects() : Promise.resolve([]),
  ]);
  let projects: ProviderWorkspaceProject[] = [...claudeProjects, ...codexProjects];
  if (registry) {
    projects = applyProjectRegistryMetadata(projects, registry);
    const board = await readBoard();
    const discoveries = collectProjectRegistryDiscoveries(projects);
    if (needsMigration) discoveries.unshift(...collectLegacyBoardDiscoveries(board));
    if (needsMigration || projectRegistryNeedsReconciliation(registry, discoveries)) {
      try {
        registry = await migrateBoardProjectsToRegistry(board.projects, discoveries);
        projects = applyProjectRegistryMetadata(projects, registry);
      } catch {
        // Fail closed on malformed/locked shared state while preserving the last valid Workspace view.
      }
    }
  }
  projects = projects
    .filter((project) => filter === "all" || project.provider === filter)
    .sort((a, b) => b.lastActivity - a.lastActivity);
  const merged = filter === "all" ? mergeProviderProjectsByPath(projects) : projects;
  return merged.filter(
    (project) => !(project.provider === "codex" && project.lastActivity === 0 && !project.recall),
  );
}

export async function getProviderProjectSessions(
  projectId: string,
  options: { pinnedOnly?: boolean } = {},
): Promise<SessionRecall[]> {
  if (projectId.startsWith("codex:")) {
    const provider = getProviders("codex")[0];
    const board = await readBoardWithProjectRegistry();
    const sessions = (await provider.listSessions())
      .filter((session) => session.projectId === projectId)
      .map((session) => normalizedSessionToRecall(session, board));
    return sessions
      .filter((session) => !options.pinnedOnly || (session.pinned && session.sessionKind === "main"))
      .sort((a, b) => b.transcriptMtime - a.transcriptMtime);
  }
  return options.pinnedOnly ? getPinnedProjectSessions(projectId) : getProjectSessions(projectId);
}

export async function getProviderEnrichedPlans(
  archived: boolean,
  filter: ProviderFilter = "claude",
): Promise<EnrichedPlan[]> {
  if (filter === "codex") return [];
  return (await getEnrichedPlans(archived)).map((plan) => ({ ...plan, provider: "claude" as const }));
}

function codexSessionToTimelineEvent(session: NormalizedSession, board: BoardData): TimelineEvent {
  const sessionBoard = board.sessions[session.id];
  return {
    ts: parseTimeMs(session.updatedAt),
    kind: "session",
    projectId: session.projectId ?? null,
    realPath: session.cwd ?? null,
    title: session.title ?? session.lastUserText ?? "(제목 없음)",
    sessionId: session.id,
    status: sessionBoard?.status ?? (session.projectId ? board.projects[session.projectId]?.status : undefined) ?? "진행중",
    sessionKind: session.sessionKind,
    pinned: sessionBoard?.pinned === true,
    lastPrompt: session.lastUserText ?? null,
    lastAssistantSnippet: session.lastAssistantText ?? null,
    lastModel: session.model ?? null,
    startedAt: session.startedAt ? parseTimeMs(session.startedAt) : null,
    turnCount: session.turnCount ?? null,
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
    const board = await readBoardWithProjectRegistry();
    events.push(...filterUserFacingSessions(await provider.listSessions()).map((session) => codexSessionToTimelineEvent(session, board)));
  }
  const sessionIds = new Set(events.filter((event) => event.kind === "session" && event.sessionId).map((event) => event.sessionId!));
  return events
    .filter((event) => event.kind !== "plan" || (event.parentSessionId && sessionIds.has(event.parentSessionId)))
    .sort((a, b) => b.ts - a.ts);
}
