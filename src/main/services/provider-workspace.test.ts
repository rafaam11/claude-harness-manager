import { describe, expect, it } from "vitest";
import { HttpError, routeRequest } from "../router.js";
import type { ApiRequest } from "@shared/types";
import { mergeProviderProjectsByPath, sortNormalizedProjects, toTimelineEvents } from "./provider-workspace.js";

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
