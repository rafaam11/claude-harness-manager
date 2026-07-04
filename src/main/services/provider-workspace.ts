import type {
  NormalizedPlan,
  NormalizedProject,
  NormalizedSession,
  NormalizedTimelineEvent,
  ProviderFilter,
} from "@shared/provider-types";
import { getProviders } from "../providers/registry.js";

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
      kind: s.provider === "codex" ? "memory" : "session",
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
