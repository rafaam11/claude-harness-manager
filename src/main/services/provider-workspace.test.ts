import { describe, expect, it } from "vitest";
import { HttpError, routeRequest } from "../router.js";
import type { ApiRequest } from "@shared/types";
import {
  filterUserFacingSessions,
  mergeProviderProjectsByPath,
  sortNormalizedProjects,
  toTimelineEvents,
} from "./provider-workspace.js";

function req(url: string): ApiRequest {
  return { method: "GET", url };
}

describe("provider workspace normalization", () => {
  it("merges Claude and Codex projects that point at the same real path", () => {
    const merged = mergeProviderProjectsByPath([
      {
        id: "claude:C--repo",
        provider: "claude",
        realPath: "C:\\repo",
        gitBranch: "main",
        lastActivity: 10,
        staleDays: 0,
        recall: null,
        todos: null,
        board: { status: null, memo: "", nameOverride: "", tracks: [], hidden: false, order: null },
        repoRoot: "C:\\repo",
        isWorktree: false,
        worktreeName: null,
        worktrees: [],
        memberIds: ["claude:C--repo"],
      },
      {
        id: "codex:C--repo",
        provider: "codex",
        realPath: "c:/repo",
        gitBranch: null,
        lastActivity: 20,
        staleDays: 0,
        recall: { sessionId: "codex:s", aiTitle: "Codex", lastPrompt: "p", lastAssistantSnippet: null, cwd: "c:/repo", gitBranch: null, lastModel: "gpt-5.5", transcriptPath: "s", transcriptMtime: 20, truncatedScan: true },
        todos: null,
        board: { status: null, memo: "", nameOverride: "", tracks: [], hidden: false, order: null },
        repoRoot: "c:/repo",
        isWorktree: false,
        worktreeName: null,
        worktrees: [],
        memberIds: ["codex:C--repo"],
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "codex:C--repo",
      lastActivity: 20,
      realPath: "c:/repo",
    });
    expect(merged[0].memberIds).toEqual(["codex:C--repo", "claude:C--repo"]);
    expect(merged[0].provider).toBeUndefined();
  });

  it("keeps a merged repo visible when only one provider archived it", () => {
    // 한쪽(Claude)에서 보관·숨김 처리한 프로젝트가 활성 Codex 프로젝트와 병합되어도,
    // 다른 provider의 세션을 가리지 않도록 대표 카드는 활성(hidden:false, status≠보관)이어야 한다.
    const merged = mergeProviderProjectsByPath([
      {
        id: "claude:C--repo",
        provider: "claude",
        realPath: "C:\\repo",
        gitBranch: null,
        lastActivity: 30, // primary(최근)이지만 보관/숨김
        staleDays: 0,
        recall: null,
        todos: null,
        board: { status: "보관", memo: "", nameOverride: "", tracks: [], hidden: true, order: null },
        repoRoot: "C:\\repo",
        isWorktree: false,
        worktreeName: null,
        worktrees: [],
        memberIds: ["claude:C--repo"],
      },
      {
        id: "codex:C--repo",
        provider: "codex",
        realPath: "c:/repo",
        gitBranch: null,
        lastActivity: 20,
        staleDays: 0,
        recall: null,
        todos: null,
        board: { status: null, memo: "", nameOverride: "", tracks: [], hidden: false, order: null },
        repoRoot: "c:/repo",
        isWorktree: false,
        worktreeName: null,
        worktrees: [],
        memberIds: ["codex:C--repo"],
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].board.hidden).toBe(false); // 모든 멤버가 숨김일 때만 숨김
    expect(merged[0].board.status).not.toBe("보관"); // 가장 활성 멤버 기준
    expect(merged[0].memberIds).toEqual(["claude:C--repo", "codex:C--repo"]);
  });

  it("hides a merged repo only when every provider archived it", () => {
    const archived = { status: "보관" as const, memo: "", nameOverride: "", tracks: [], hidden: true, order: null };
    const merged = mergeProviderProjectsByPath([
      {
        id: "claude:C--repo",
        provider: "claude",
        realPath: "C:\\repo",
        gitBranch: null,
        lastActivity: 30,
        staleDays: 0,
        recall: null,
        todos: null,
        board: archived,
        repoRoot: "C:\\repo",
        isWorktree: false,
        worktreeName: null,
        worktrees: [],
        memberIds: ["claude:C--repo"],
      },
      {
        id: "codex:C--repo",
        provider: "codex",
        realPath: "c:/repo",
        gitBranch: null,
        lastActivity: 20,
        staleDays: 0,
        recall: null,
        todos: null,
        board: archived,
        repoRoot: "c:/repo",
        isWorktree: false,
        worktreeName: null,
        worktrees: [],
        memberIds: ["codex:C--repo"],
      },
    ]);

    expect(merged[0].board.hidden).toBe(true);
    expect(merged[0].board.status).toBe("보관");
  });

  it("sorts projects by latest activity descending", () => {
    const projects = sortNormalizedProjects([
      {
        id: "codex:local",
        provider: "codex",
        localId: "local",
        title: "Codex Local Context",
        realPath: null,
        latestActivityAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "claude:D--repo",
        provider: "claude",
        localId: "D--repo",
        title: "repo",
        realPath: "D:\\repo",
        latestActivityAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    expect(projects.map((p) => p.id)).toEqual(["claude:D--repo", "codex:local"]);
  });

  it("turns Codex sessions into session timeline events, not memory events", () => {
    const events = toTimelineEvents(
      [
        {
          id: "codex:memory-summary",
          provider: "codex",
          projectId: "codex:local",
          sessionKind: "main",
          title: "memory_summary.md",
          updatedAt: "2026-03-01T00:00:00.000Z",
          sourcePath: "memory_summary.md",
        },
      ],
      [],
    );
    expect(events[0]).toMatchObject({
      id: "codex:memory-summary",
      provider: "codex",
      kind: "session",
      projectId: "codex:local",
    });
  });

  it("keeps only direct user-facing sessions for Codex timeline surfaces", () => {
    const sessions = filterUserFacingSessions([
      {
        id: "codex:main",
        provider: "codex",
        projectId: "codex:repo",
        sessionKind: "main",
        title: "사용자 대화",
        updatedAt: "2026-07-05T01:00:00.000Z",
      },
      {
        id: "codex:worker",
        provider: "codex",
        projectId: "codex:repo",
        sessionKind: "worker",
        title: "subagent fragment",
        updatedAt: "2026-07-05T01:01:00.000Z",
      },
      {
        id: "codex:system",
        provider: "codex",
        projectId: "codex:repo",
        sessionKind: "system",
        title: "injected context",
        updatedAt: "2026-07-05T01:02:00.000Z",
      },
      {
        id: "claude:worker-kept",
        provider: "claude",
        projectId: "claude:repo",
        sessionKind: "worker",
        title: "Claude 기존 정책 유지",
        updatedAt: "2026-07-05T01:03:00.000Z",
      },
    ]);

    expect(sessions.map((s) => s.id)).toEqual(["codex:main", "claude:worker-kept"]);
  });

  it("rejects empty provider filter on normalized workspace routes", async () => {
    await expect(routeRequest(req("/api/workspace/normalized/projects?provider="))).rejects.toMatchObject({
      statusCode: 400,
      message: "invalid provider filter",
    } satisfies Partial<HttpError>);

    await expect(routeRequest(req("/api/workspace/normalized/timeline?provider="))).rejects.toMatchObject({
      statusCode: 400,
      message: "invalid provider filter",
    } satisfies Partial<HttpError>);
  });

  it("rejects invalid provider filter on normalized workspace routes", async () => {
    await expect(routeRequest(req("/api/workspace/normalized/projects?provider=bogus"))).rejects.toMatchObject({
      statusCode: 400,
      message: "invalid provider filter",
    } satisfies Partial<HttpError>);

    await expect(routeRequest(req("/api/workspace/normalized/timeline?provider=bogus"))).rejects.toMatchObject({
      statusCode: 400,
      message: "invalid provider filter",
    } satisfies Partial<HttpError>);
  });
});
