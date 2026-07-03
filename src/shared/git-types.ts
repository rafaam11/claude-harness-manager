// DT_GitManager에서 흡수한 git 도메인 타입.
// renderer ↔ main 계약은 단일 채널(api:invoke) + router를 거치므로, DT의 요청 타입에 있던
// repoId는 전부 projectId로 바꿨다(main이 projectId → repoPath를 resolveRepoPath로 해석).
// GitHub/clone/auth 관련 타입과 DT의 IpcChannels/RendererApi는 1차 흡수에서 제외했다.

export const MIN_GIT_VERSION = "2.23.0";

export interface GitVersionInfo {
  raw: string;
  version: string;
  supported: boolean;
}

/** projectId로 해석한 실제 git 저장소 경로. source는 어디서 왔는지(디버그/UI 표시용). */
export interface RepoResolution {
  repoPath: string;
  source: "board" | "recall" | "guess" | "worktree";
}

export type StatusEntryKind = "tracked" | "renamed" | "unmerged" | "untracked" | "ignored";

export interface StatusEntry {
  path: string;
  origPath: string | null;
  /** porcelain v2 index(X) status char, '.' = unchanged */
  indexStatus: string;
  /** porcelain v2 worktree(Y) status char, '.' = unchanged */
  worktreeStatus: string;
  kind: StatusEntryKind;
}

export interface RepoStatus {
  /** current branch name, null when detached HEAD */
  branch: string | null;
  detached: boolean;
  /** current commit oid, null before the first commit */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  /** total entries excluding ignored */
  changedCount: number;
  entries: StatusEntry[];
}

/** Result of a non-streaming git action that surfaces git's own error message on failure. */
export type GitActionResult = { ok: true } | { ok: false; message: string };

export type CommitResult = { ok: true } | { ok: false; message: string };

// --- diff ---

export interface DiffRequest {
  projectId: string;
  path: string;
  /** true = `git diff --cached` (index vs HEAD), false = worktree vs index */
  staged: boolean;
  kind: StatusEntryKind;
}

export type DiffLineType = "add" | "del" | "context";

export interface DiffLine {
  type: DiffLineType;
  /** line body with the leading +/-/space sign stripped */
  content: string;
  /** old-side line number, null for added lines */
  oldLine: number | null;
  /** new-side line number, null for deleted lines */
  newLine: number | null;
}

export interface DiffHunk {
  /** the `@@ -a,b +c,d @@` header line */
  header: string;
  lines: DiffLine[];
}

export type DiffFileKind = "modified" | "added" | "deleted" | "renamed" | "binary";

export interface DiffFile {
  from: string | null;
  to: string | null;
  kind: DiffFileKind;
  binary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export type DiffResult = { ok: true; file: DiffFile | null } | { ok: false; message: string };

// --- long-running remote operations (push/pull/fetch/publish) ---
// 진행 이벤트 스트리밍/취소는 1차에서 제외. 완료까지 대기 후 결과만 반환한다.

/** 'publish' pushes a branch that has no upstream yet (push -u origin HEAD). */
export type GitOpKind = "push" | "pull" | "fetch" | "publish";

export interface GitOpRequest {
  projectId: string;
  kind: GitOpKind;
}

export type GitOpResult =
  | { ok: true; output: string }
  | { ok: false; code: number | null; message: string; canceled: boolean };

// --- commit graph (git log DAG) ---

export type RefKind = "head" | "branch" | "remote" | "tag";

export interface RefDecoration {
  kind: RefKind;
  /** display name: 'main', 'origin/main', 'v1.0'; for kind 'head' this is 'HEAD' */
  name: string;
}

export interface CommitNode {
  /** full 40-char hash */
  oid: string;
  /** parent oids, first-parent first; [] for a root commit */
  parents: string[];
  refs: RefDecoration[];
  authorName: string;
  authorEmail: string;
  /** author time, unix seconds (from %at) */
  authorTime: number;
  subject: string;
}

export interface GraphRequest {
  projectId: string;
  /** hard cap on commits walked; default 2000 */
  limit?: number;
}

export type GraphPayload =
  | {
      ok: true;
      /** commits in git topo order (parents after children) */
      commits: CommitNode[];
      /** oid of HEAD, or null in an empty / unborn repo */
      headOid: string | null;
      /** true when more commits exist beyond the requested limit */
      truncated: boolean;
    }
  | { ok: false; message: string };

// --- commit detail (right panel) ---

export type CommitFileStatus = "A" | "M" | "D" | "R" | "C" | "T";

export interface CommitFileChange {
  status: CommitFileStatus;
  path: string;
  /** original path for renames/copies, else null */
  origPath: string | null;
}

export interface CommitDetail {
  oid: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  commitTime: number;
  subject: string;
  /** full message minus the subject line */
  body: string;
  files: CommitFileChange[];
  /** true when this commit has more than one parent (diff is vs first parent) */
  isMerge: boolean;
}

export interface CommitDetailRequest {
  projectId: string;
  oid: string;
}

export type CommitDetailResult =
  | { ok: true; detail: CommitDetail }
  | { ok: false; message: string };

export interface CommitDiffRequest {
  projectId: string;
  oid: string;
  /** parent to diff against (parents[0]); null for a root commit (diff vs empty tree) */
  parentOid: string | null;
  path: string;
}

// --- graph context-menu actions ---

export type GraphActionKind =
  | "checkout"
  | "branch-create"
  | "branch-delete"
  | "merge"
  | "rebase"
  | "cherry-pick"
  | "revert"
  | "reset-soft"
  | "reset-mixed"
  | "reset-hard"
  | "tag-create"
  | "tag-delete"
  | "merge-abort"
  | "merge-continue"
  | "rebase-abort"
  | "rebase-continue"
  | "rebase-skip"
  | "cherry-pick-abort"
  | "cherry-pick-continue"
  | "cherry-pick-skip"
  | "revert-abort"
  | "revert-continue"
  /** switch to a remote branch, creating a tracking local branch (ref = 'origin/feat') */
  | "checkout-track"
  /** create a branch at HEAD and switch to it (name) */
  | "branch-create-checkout";

export interface GraphActionRequest {
  projectId: string;
  kind: GraphActionKind;
  /** target commit oid (checkout/branch-create/reset/cherry-pick/revert/tag-create) */
  oid?: string;
  /** target ref name (checkout branch, merge, rebase, branch-delete, tag-delete) */
  ref?: string;
  /** new branch/tag name (branch-create, tag-create) */
  name?: string;
  /** force flag (branch -D) */
  force?: boolean;
}

export type GraphActionResult = { ok: true } | { ok: false; message: string };

// --- branches (branch switcher) ---

export interface BranchInfo {
  /** full refname, e.g. refs/heads/main or refs/remotes/origin/feat */
  refName: string;
  /** short name: 'main' or 'origin/feat' */
  shortName: string;
  /** local branch to switch to: 'main', or 'feat' for a remote (remote prefix stripped) */
  localName: string;
  kind: "local" | "remote";
  isCurrent: boolean;
  /** last commit time, unix seconds (for sorting/display) */
  committerDate: number;
  upstream: string | null;
}

export type BranchListResult =
  | { ok: true; branches: BranchInfo[] }
  | { ok: false; message: string };

// --- in-progress operation (merge/rebase/cherry-pick/revert) ---

export type InProgressKind = "merge" | "rebase" | "cherry-pick" | "revert" | null;

export interface InProgressState {
  kind: InProgressKind;
  /** for rebase: 'merge' (interactive/rebase-merge) or 'apply' (rebase-apply); else null */
  rebaseStyle?: "merge" | "apply" | null;
  current?: number | null;
  total?: number | null;
  /** the branch/onto being operated on, when readable from state files */
  ontoRef?: string | null;
}

export type InProgressResult =
  | { ok: true; state: InProgressState }
  | { ok: false; message: string };
