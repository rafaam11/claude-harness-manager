// Git facade. router는 projectId만 받고, 여기서 repoPath를 해석·검증한 뒤 서비스를 호출한다.
// renderer는 실제 repo 경로를 들고 다니지 않는다(보안 + 단순화): 항상 projectId로만 요청한다.
import { readBoard } from "../../lib/board.js";
import { splitEntityId } from "../../providers/registry.js";
import { codexProvider } from "../../providers/codex.js";
import { guessOriginalPath } from "../projects.js";
import { getProjectRecalls } from "../recall.js";
import { resolveRepoTopology } from "../repo-group.js";
import { assertGitRepo } from "./repo-guard.js";
import { getGitVersion, getRepoStatus } from "./GitService.js";
import { getGraph } from "./LogService.js";
import { getDiff } from "./DiffService.js";
import { listBranches } from "./BranchService.js";
import { getInProgress } from "./inProgress.js";
import { getCommitDetail, getCommitDiff } from "./CommitDetailService.js";
import { stageFiles, unstageFiles, discardFiles } from "./StageService.js";
import { commit } from "./CommitService.js";
import { runGraphAction } from "./GraphActionsService.js";
import { runRemoteOp } from "./RemoteService.js";
import type {
  BranchListResult,
  CommitDetailResult,
  CommitDiffRequest,
  CommitResult,
  DiffRequest,
  DiffResult,
  GitActionResult,
  GitOpKind,
  GitOpResult,
  GitVersionInfo,
  GraphActionRequest,
  GraphPayload,
  InProgressResult,
  RepoResolution,
  RepoStatus,
} from "@shared/types";

function localProjectId(projectId: string): string {
  const split = splitEntityId(projectId);
  return split.provider === "claude" || split.provider === "codex" ? split.localId : projectId;
}

function projectIdCandidates(projectId: string): string[] {
  const split = splitEntityId(projectId);
  if (split.provider !== "claude") return [projectId];
  const prefixed = `claude:${split.localId}`;
  return prefixed === projectId ? [prefixed, split.localId] : [prefixed, projectId];
}

/**
 * projectId → 검증된 git toplevel 경로.
 *  1) board.json의 사용자 교정값(repoPath)
 *  2) recall이 transcript cwd에서 계산한 realPath(가장 정확)
 *  3) flatten 디렉토리명 역추정(부정확한 최후 후보)
 * 각 후보는 assertGitRepo(rev-parse)로 검증한다. 못 찾으면 null.
 */
export async function resolveRepoPath(projectId: string): Promise<RepoResolution | null> {
  const board = await readBoard();
  const boardRepoPath = projectIdCandidates(projectId)
    .map((id) => board.projects[id]?.repoPath)
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const fromBoard = await assertGitRepo(boardRepoPath);
  if (fromBoard) return { repoPath: fromBoard, source: "board" };

  const localId = localProjectId(projectId);
  const recalls = await getProjectRecalls();
  const proj = recalls.find((r) => r.id === localId);
  const fromRecall = await assertGitRepo(proj?.realPath);
  if (fromRecall) return { repoPath: fromRecall, source: "recall" };

  const split = splitEntityId(projectId);
  if (split.provider === "codex") {
    const codexProjects = await codexProvider.listProjects();
    const codexProject = codexProjects.find((p) => p.id === projectId);
    const fromCodex = await assertGitRepo(codexProject?.realPath ?? undefined);
    if (fromCodex) return { repoPath: fromCodex, source: "recall" };
  }

  const fromGuess = await assertGitRepo(guessOriginalPath(localId));
  if (fromGuess) return { repoPath: fromGuess, source: "guess" };

  return null;
}

/**
 * worktreePath가 projectId 대표 repo와 "같은 저장소(공유 .git)"인지 검증하고 toplevel을 반환한다.
 * 워크트리 전환 대상 검증용 — 다른 저장소 경로 주입을 막는다(assertGitRepo + common-dir 일치).
 * 부적격이면 null(호출부가 대표 repo로 폴백).
 */
async function resolveWorktreePath(projectId: string, worktreePath: string): Promise<string | null> {
  const base = await resolveRepoPath(projectId);
  if (!base) return null; // 대표 repo가 없으면 worktreePath만으로 권한을 만들지 않는다.
  const wt = await assertGitRepo(worktreePath);
  if (!wt) return null;
  const [a, b] = await Promise.all([
    resolveRepoTopology(wt),
    resolveRepoTopology(base.repoPath),
  ]);
  if (a && b && a.commonDir === b.commonDir) return wt;
  return null; // 같은 저장소가 아니면 거부
}

/**
 * repoPath를 해석하거나, 못 찾으면 statusCode 404 에러를 던진다(라우트 핸들러용).
 * worktreePath가 오면(워크트리 전환) 같은 저장소인지 검증해 그 워킹트리를 cwd로 쓴다.
 */
async function requireRepoPath(projectId: string, worktreePath?: string): Promise<string> {
  if (worktreePath) {
    const wt = await resolveWorktreePath(projectId, worktreePath);
    if (wt) return wt;
  }
  const r = await resolveRepoPath(projectId);
  if (!r) {
    const err = new Error(
      "이 프로젝트의 git 저장소를 찾을 수 없습니다. 폴더를 직접 지정하세요.",
    ) as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  return r.repoPath;
}

// --- 조회 ---
export function gitVersion(): Promise<GitVersionInfo | null> {
  return getGitVersion();
}
export function resolveRepo(projectId: string, worktreePath?: string): Promise<RepoResolution | null> {
  // 워크트리 전환 대상이 오면 그 워킹트리로 해석(같은 저장소 검증). 아니면 대표 repo.
  if (worktreePath) {
    return resolveWorktreePath(projectId, worktreePath).then((wt) =>
      wt ? { repoPath: wt, source: "worktree" as const } : resolveRepoPath(projectId),
    );
  }
  return resolveRepoPath(projectId);
}
export async function gitStatus(projectId: string, worktreePath?: string): Promise<RepoStatus> {
  return getRepoStatus(await requireRepoPath(projectId, worktreePath));
}
export async function gitGraph(
  projectId: string,
  limit?: number,
  worktreePath?: string,
): Promise<GraphPayload> {
  return getGraph(await requireRepoPath(projectId, worktreePath), limit);
}
export async function gitBranches(projectId: string, worktreePath?: string): Promise<BranchListResult> {
  return listBranches(await requireRepoPath(projectId, worktreePath));
}
export async function gitInProgress(projectId: string, worktreePath?: string): Promise<InProgressResult> {
  return getInProgress(await requireRepoPath(projectId, worktreePath));
}
export async function gitCommitDetail(
  projectId: string,
  oid: string,
  worktreePath?: string,
): Promise<CommitDetailResult> {
  return getCommitDetail(await requireRepoPath(projectId, worktreePath), oid);
}
export async function gitDiff(req: DiffRequest, worktreePath?: string): Promise<DiffResult> {
  return getDiff(await requireRepoPath(req.projectId, worktreePath), req);
}
export async function gitCommitDiff(
  req: CommitDiffRequest,
  worktreePath?: string,
): Promise<DiffResult> {
  return getCommitDiff(await requireRepoPath(req.projectId, worktreePath), req);
}

// --- 변경(staging/commit) ---
export async function gitStage(
  projectId: string,
  paths: string[],
  worktreePath?: string,
): Promise<GitActionResult> {
  return stageFiles(await requireRepoPath(projectId, worktreePath), paths);
}
export async function gitUnstage(
  projectId: string,
  paths: string[],
  worktreePath?: string,
): Promise<GitActionResult> {
  return unstageFiles(await requireRepoPath(projectId, worktreePath), paths);
}
export async function gitDiscard(
  projectId: string,
  paths: string[],
  worktreePath?: string,
): Promise<GitActionResult> {
  return discardFiles(await requireRepoPath(projectId, worktreePath), paths);
}
export async function gitCommit(
  projectId: string,
  message: string,
  worktreePath?: string,
): Promise<CommitResult> {
  return commit(await requireRepoPath(projectId, worktreePath), message);
}

// --- 그래프 액션 / remote ---
export async function gitAction(req: GraphActionRequest, worktreePath?: string): Promise<GitActionResult> {
  return runGraphAction(await requireRepoPath(req.projectId, worktreePath), req);
}
export async function gitRemote(
  projectId: string,
  kind: GitOpKind,
  worktreePath?: string,
): Promise<GitOpResult> {
  return runRemoteOp(await requireRepoPath(projectId, worktreePath), kind);
}
