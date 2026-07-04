import { describe, expect, it } from "vitest";
import { resolveWorkspaceSelection, workspaceProviderToneClass } from "./Workspace";
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
  it("uses a single subtle provider tone instead of per-item text badges", () => {
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
    } satisfies Omit<WorkspaceProject, "id" | "provider" | "memberIds">;

    expect(
      workspaceProviderToneClass({
        ...base,
        id: "codex:C--repo",
        provider: undefined,
        memberIds: ["codex:C--repo", "claude:C--repo"],
      }),
    ).toBe(" ws-provider-mixed");
    expect(workspaceProviderToneClass({ ...base, id: "claude:C--repo", provider: "claude", memberIds: [] })).toBe(
      " ws-provider-claude",
    );
    expect(workspaceProviderToneClass({ ...base, id: "codex:C--repo", provider: "codex", memberIds: [] })).toBe(
      " ws-provider-codex",
    );
  });

});
