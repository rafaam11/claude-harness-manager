import { describe, expect, it } from "vitest";
import { resolveWorkspaceSelection } from "./Workspace";
import type { WorkspaceProject } from "./workspace-shared";

describe("provider workspace selection", () => {
  it("revalidates a stale selectedId against the current project list", () => {
    const base = {
      realPath: null,
      gitBranch: null,
      lastActivity: 0,
      staleDays: 0,
      recall: null,
      todos: null,
      board: { status: null, memo: "", nameOverride: "", tracks: [], hidden: false, order: null },
      repoRoot: null,
      isWorktree: false,
      worktreeName: null,
      worktrees: [],
      memberIds: [],
    } satisfies Omit<WorkspaceProject, "id" | "provider">;
    const projects: WorkspaceProject[] = [
      { ...base, id: "claude:alpha", provider: "claude" },
      { ...base, id: "codex:beta", provider: "codex" },
    ];

    expect(resolveWorkspaceSelection("codex:stale", projects, 0)).toBe("claude:alpha");
  });
});
