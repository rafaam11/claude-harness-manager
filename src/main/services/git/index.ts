// Git facade. router는 projectId만 받고, 여기서 repoPath를 해석·검증한 뒤 서비스를 호출한다.
// renderer는 실제 repo 경로를 들고 다니지 않는다(보안 + 단순화): 항상 projectId로만 요청한다.
import { readBoard } from "../../lib/board.js";
import { guessOriginalPath } from "../projects.js";
import { getProjectRecalls } from "../recall.js";
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

/**
 * projectId → 검증된 git toplevel 경로.
 *  1) board.json의 사용자 교정값(repoPath)
 *  2) recall이 transcript cwd에서 계산한 realPath(가장 정확)
 *  3) flatten 디렉토리명 역추정(부정확한 최후 후보)
 * 각 후보는 assertGitRepo(rev-parse)로 검증한다. 못 찾으면 null.
 */
export async function resolveRepoPath(projectId: string): Promise<RepoResolution | null> {
  const board = await readBoard();
  const fromBoard = await assertGitRepo(board.projects[projectId]?.repoPath);
  if (fromBoard) return { repoPath: fromBoard, source: "board" };

  const recalls = await getProjectRecalls();
  const proj = recalls.find((r) => r.id === projectId);
  const fromRecall = await assertGitRepo(proj?.realPath);
  if (fromRecall) return { repoPath: fromRecall, source: "recall" };

  const fromGuess = await assertGitRepo(guessOriginalPath(projectId));
  if (fromGuess) return { repoPath: fromGuess, source: "guess" };

  return null;
}

/** repoPath를 해석하거나, 못 찾으면 statusCode 404 에러를 던진다(라우트 핸들러용). */
async function requireRepoPath(projectId: string): Promise<string> {
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
export function resolveRepo(projectId: string): Promise<RepoResolution | null> {
  return resolveRepoPath(projectId);
}
export async function gitStatus(projectId: string): Promise<RepoStatus> {
  return getRepoStatus(await requireRepoPath(projectId));
}
export async function gitGraph(projectId: string, limit?: number): Promise<GraphPayload> {
  return getGraph(await requireRepoPath(projectId), limit);
}
export async function gitBranches(projectId: string): Promise<BranchListResult> {
  return listBranches(await requireRepoPath(projectId));
}
export async function gitInProgress(projectId: string): Promise<InProgressResult> {
  return getInProgress(await requireRepoPath(projectId));
}
export async function gitCommitDetail(projectId: string, oid: string): Promise<CommitDetailResult> {
  return getCommitDetail(await requireRepoPath(projectId), oid);
}
export async function gitDiff(req: DiffRequest): Promise<DiffResult> {
  return getDiff(await requireRepoPath(req.projectId), req);
}
export async function gitCommitDiff(req: CommitDiffRequest): Promise<DiffResult> {
  return getCommitDiff(await requireRepoPath(req.projectId), req);
}

// --- 변경(staging/commit) ---
export async function gitStage(projectId: string, paths: string[]): Promise<GitActionResult> {
  return stageFiles(await requireRepoPath(projectId), paths);
}
export async function gitUnstage(projectId: string, paths: string[]): Promise<GitActionResult> {
  return unstageFiles(await requireRepoPath(projectId), paths);
}
export async function gitDiscard(projectId: string, paths: string[]): Promise<GitActionResult> {
  return discardFiles(await requireRepoPath(projectId), paths);
}
export async function gitCommit(projectId: string, message: string): Promise<CommitResult> {
  return commit(await requireRepoPath(projectId), message);
}

// --- 그래프 액션 / remote ---
export async function gitAction(req: GraphActionRequest): Promise<GitActionResult> {
  return runGraphAction(await requireRepoPath(req.projectId), req);
}
export async function gitRemote(projectId: string, kind: GitOpKind): Promise<GitOpResult> {
  return runRemoteOp(await requireRepoPath(projectId), kind);
}
