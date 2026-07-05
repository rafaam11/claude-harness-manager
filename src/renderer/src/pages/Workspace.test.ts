import { describe, expect, it } from "vitest";
import {
  initialWorkspaceSortMode,
  mergeWorkspaceSessionLists,
  partitionWorkspaceSessions,
  resolveWorkspaceSelection,
  workspaceProjectMetricLabels,
  workspaceProviderToneClass,
} from "./Workspace";
import type { SessionRecall, WorkspaceProject } from "./workspace-shared";

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

  it("keeps OMX/subagent worker sessions out of the default session list", () => {
    const base = {
      sessionId: null,
      aiTitle: null,
      lastPrompt: null,
      lastAssistantSnippet: null,
      cwd: null,
      gitBranch: null,
      lastModel: null,
      transcriptPath: "",
      transcriptMtime: 0,
      truncatedScan: false,
    } satisfies Omit<SessionRecall, "sessionKind">;
    const sessions: SessionRecall[] = [
      { ...base, sessionId: "codex:main", transcriptPath: "main", sessionKind: "main" },
      { ...base, sessionId: "codex:worker", transcriptPath: "worker", sessionKind: "worker" },
      { ...base, sessionId: "codex:unknown", transcriptPath: "unknown", sessionKind: "unknown" },
    ];

    expect(partitionWorkspaceSessions(sessions)).toEqual({
      primary: [sessions[0], sessions[2]],
      auxiliary: [sessions[1]],
    });
  });

  it("dedupes sessions loaded through repeated provider member ids", () => {
    const base = {
      sessionId: "claude:shared",
      sessionKind: "main" as const,
      aiTitle: "대표 세션",
      lastPrompt: "마지막 요청",
      lastAssistantSnippet: null,
      cwd: "C:/repo",
      gitBranch: null,
      lastModel: "claude-sonnet-5",
      transcriptPath: "C:/repo/.claude/projects/shared.jsonl",
      transcriptMtime: 10,
      truncatedScan: false,
    } satisfies SessionRecall;
    const duplicateFromWorktreeMember = {
      ...base,
      aiTitle: null,
      lastPrompt: null,
      transcriptMtime: 12,
    } satisfies SessionRecall;
    const other = {
      ...base,
      sessionId: "codex:other",
      aiTitle: "다른 세션",
      transcriptPath: "codex-other",
      transcriptMtime: 20,
    } satisfies SessionRecall;

    expect(mergeWorkspaceSessionLists([[base], [duplicateFromWorktreeMember], [other]])).toEqual([
      other,
      expect.objectContaining({
        sessionId: "claude:shared",
        aiTitle: "대표 세션",
        lastPrompt: "마지막 요청",
        transcriptMtime: 12,
      }),
    ]);
  });

  it("defaults the workspace sort to status order unless the stored preference is valid", () => {
    expect(initialWorkspaceSortMode(null)).toBe("status");
    expect(initialWorkspaceSortMode("")).toBe("status");
    expect(initialWorkspaceSortMode("recent")).toBe("recent");
    expect(initialWorkspaceSortMode("manual")).toBe("manual");
    expect(initialWorkspaceSortMode("unknown")).toBe("status");
  });

  it("does not expose worktree counts as separate workspace card metrics", () => {
    const project = {
      id: "claude:C--repo",
      provider: "claude" as const,
      realPath: null,
      gitBranch: null,
      lastActivity: 0,
      staleDays: 0,
      recall: null,
      todos: null,
      board: {
        status: null,
        memo: "",
        nameOverride: "",
        tracks: [{ id: "t", title: "track", items: [{ id: "i", text: "done", done: true }] }],
        hidden: false,
        order: null,
      },
      repoRoot: null,
      isWorktree: false,
      worktreeName: null,
      worktrees: [
        {
          name: "linked",
          projectId: "claude:C--repo-linked",
          worktreeRoot: "C:/repo-linked",
          gitBranch: "feature",
          lastActivity: 1,
          lastPrompt: "prompt",
          lastAssistantSnippet: null,
          removed: false,
        },
      ],
      memberIds: [],
    } satisfies WorkspaceProject;

    expect(workspaceProjectMetricLabels(project, 2)).toEqual(["✓ 1/1", "📄 2"]);
  });
});
