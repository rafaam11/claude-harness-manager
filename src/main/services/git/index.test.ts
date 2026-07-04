import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readBoard = vi.fn();
const guessOriginalPath = vi.fn();
const getProjectRecalls = vi.fn();
const resolveRepoTopology = vi.fn();
const assertGitRepo = vi.fn();

vi.mock("../../lib/board.js", () => ({
  readBoard,
}));

vi.mock("../projects.js", () => ({
  guessOriginalPath,
}));

vi.mock("../recall.js", () => ({
  getProjectRecalls,
}));

vi.mock("../repo-group.js", () => ({
  resolveRepoTopology,
}));

vi.mock("./repo-guard.js", () => ({
  assertGitRepo,
}));

vi.mock("./GitService.js", () => ({
  getGitVersion: vi.fn(),
  getRepoStatus: vi.fn(),
}));

vi.mock("./LogService.js", () => ({
  getGraph: vi.fn(),
}));

vi.mock("./DiffService.js", () => ({
  getDiff: vi.fn(),
}));

vi.mock("./BranchService.js", () => ({
  listBranches: vi.fn(),
}));

vi.mock("./inProgress.js", () => ({
  getInProgress: vi.fn(),
}));

vi.mock("./CommitDetailService.js", () => ({
  getCommitDetail: vi.fn(),
  getCommitDiff: vi.fn(),
}));

vi.mock("./StageService.js", () => ({
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  discardFiles: vi.fn(),
}));

vi.mock("./CommitService.js", () => ({
  commit: vi.fn(),
}));

vi.mock("./GraphActionsService.js", () => ({
  runGraphAction: vi.fn(),
}));

vi.mock("./RemoteService.js", () => ({
  runRemoteOp: vi.fn(),
}));

async function loadGitModule() {
  return import("./index.js");
}

beforeEach(() => {
  vi.resetModules();
  readBoard.mockReset();
  guessOriginalPath.mockReset();
  getProjectRecalls.mockReset();
  resolveRepoTopology.mockReset();
  assertGitRepo.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("git facade Claude id compatibility", () => {
  it("uses prefixed board keys and strips Claude ids for recall and path guessing", async () => {
    readBoard.mockResolvedValue({
      schemaVersion: 2,
      projects: {
        "claude:D--repo": { repoPath: "C:/repos/from-board" },
      },
      plans: {},
      sessions: {},
    });
    assertGitRepo.mockImplementation(async (value?: string | null) => value ?? null);

    const { resolveRepoPath } = await loadGitModule();
    const resolved = await resolveRepoPath("claude:D--repo");

    expect(resolved).toEqual({ repoPath: "C:/repos/from-board", source: "board" });
    expect(assertGitRepo).toHaveBeenCalledWith("C:/repos/from-board");
    expect(getProjectRecalls).not.toHaveBeenCalled();
    expect(guessOriginalPath).not.toHaveBeenCalled();
  });

  it("falls back through local Claude ids for recall lookup and guessOriginalPath", async () => {
    readBoard.mockResolvedValue({
      schemaVersion: 2,
      projects: {},
      plans: {},
      sessions: {},
    });
    getProjectRecalls.mockResolvedValue([
      {
        id: "D--repo",
        realPath: "C:/repos/from-recall",
        gitBranch: null,
        lastActivity: 0,
        staleDays: 0,
        recall: null,
        todos: null,
      },
    ]);
    guessOriginalPath.mockReturnValue("C:/repos/from-guess");
    assertGitRepo.mockImplementation(async (value?: string | null) =>
      value === "C:/repos/from-recall" || value === "C:/repos/from-guess" ? value : null,
    );

    const { resolveRepoPath } = await loadGitModule();
    const resolved = await resolveRepoPath("claude:D--repo");

    expect(resolved).toEqual({ repoPath: "C:/repos/from-recall", source: "recall" });
    expect(getProjectRecalls).toHaveBeenCalledTimes(1);
    expect(guessOriginalPath).not.toHaveBeenCalled();
  });
});

describe("git facade worktree authority", () => {
  it("does not accept a worktreePath when the base project repo cannot be resolved", async () => {
    readBoard.mockResolvedValue({
      schemaVersion: 2,
      projects: {},
      plans: {},
      sessions: {},
    });
    getProjectRecalls.mockResolvedValue([]);
    guessOriginalPath.mockReturnValue("C:/missing/base");
    assertGitRepo.mockImplementation(async (value?: string | null) =>
      value === "C:/repos/other-worktree" ? value : null,
    );

    const { resolveRepo } = await loadGitModule();
    const resolved = await resolveRepo("claude:D--missing", "C:/repos/other-worktree");

    expect(resolved).toBeNull();
    expect(resolveRepoTopology).not.toHaveBeenCalled();
  });
});
