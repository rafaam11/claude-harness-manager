// Workspace / Timeline 페이지가 공유하는 타입과 이름 헬퍼.
// 서버(services/recall.ts)의 응답 형태와 1:1 대응한다.

export type BoardStatus = "진행중" | "보류" | "완료" | "보관";
export const STATUSES: BoardStatus[] = ["진행중", "보류", "완료", "보관"];

export interface SessionRecall {
  sessionId: string | null;
  aiTitle: string | null;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  cwd: string | null;
  gitBranch: string | null;
  lastModel: string | null; // 마지막 assistant 메시지의 모델 ID
  transcriptPath: string; // 세션 목록에서 고유 key로 쓴다(sessionId는 재개된 세션끼리 겹칠 수 있음)
  transcriptMtime: number;
  truncatedScan: boolean;
}
export interface SessionTodos {
  total: number;
  done: number;
  items: { id: string; subject: string; status: string }[];
}

// 프로젝트 트랙(작업 갈래)과 그 안의 할 일. CC 세션과 무관한 앱 소유 데이터.
export interface ProjectTodo {
  id: string;
  text: string;
  done: boolean;
}
export interface ProjectTrack {
  id: string;
  title: string;
  items: ProjectTodo[];
}

// 이 repo에 접힌 linked 워크트리(대표 카드 아래 나열/Git 전환 대상). 서버 repo-group.ts와 1:1.
export interface WorktreeMember {
  projectId: string;
  worktreeRoot: string; // 워킹트리 toplevel 절대경로(Git 전환 대상)
  name: string;
  gitBranch: string | null;
  lastActivity: number;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  removed: boolean; // 디스크에서 사라진(pruned) 워크트리
}

export interface WorkspaceProject {
  id: string;
  realPath: string | null;
  gitBranch: string | null;
  lastActivity: number;
  staleDays: number;
  recall: SessionRecall | null;
  todos: SessionTodos | null;
  board: {
    status: BoardStatus | null;
    memo: string;
    nameOverride: string;
    tracks: ProjectTrack[];
    hidden: boolean;
    order: number | null;
  };
  // --- 워크트리 그룹핑 ---
  repoRoot: string | null; // 메인 워킹트리 루트(대표=repo 자신이면 realPath와 동일)
  isWorktree: boolean; // 대표가 (메인이 아닌) 워크트리인가
  worktreeName: string | null;
  worktrees: WorktreeMember[];
  memberIds: string[];
}
export interface EnrichedPlan {
  filename: string;
  title: string;
  mtime: number;
  archived: boolean;
  guessedProjectId: string | null;
  projectOverride: string | null;
  projectId: string | null;
  status: BoardStatus;
  memo: string;
}
export interface TimelineEvent {
  ts: number;
  kind: "session" | "plan";
  projectId: string | null;
  realPath: string | null;
  title: string;
  filename?: string;
  sessionId?: string; // 세션 이벤트에만. 상태 드롭다운 저장 키.
  status: BoardStatus; // 드롭다운 현재값(자동추정 or 사용자 override)
  // 행 클릭 펼침용 내용(서버 recall.ts와 1:1). 세션은 스니펫, 계획은 본문 lazy-fetch용 archived.
  lastPrompt?: string | null;
  lastAssistantSnippet?: string | null;
  archived?: boolean;
  parentSessionId?: string; // 계획 이벤트에만. 시간 근접으로 추정한 부모 세션(있을 때만).
  lastModel?: string | null; // 세션 이벤트에만. 마지막 사용 모델 ID.
  worktreeName?: string | null; // 워크트리 세션이면 그 이름(대표 repo로 귀속된 뒤 표시).
}

/** flatten된 id / 실제 경로에서 사람이 읽을 짧은 이름(경로 마지막 세그먼트) */
export function shortName(realPath: string | null, id: string): string {
  if (realPath) {
    const parts = realPath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return id.replace(/^[A-Za-z]--/, "").replace(/-/g, "/");
}

/** 사용자가 지정한 이름(nameOverride)이 있으면 우선, 없으면 기본 이름 */
export function displayName(p: WorkspaceProject): string {
  return p.board.nameOverride || shortName(p.realPath, p.id);
}

/** projectId → 표시 이름 맵. Plans 셀렉트·Timeline 라벨이 공유한다(nameOverride 반영). */
export function buildProjNameMap(projects: WorkspaceProject[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of projects) m.set(p.id, displayName(p));
  return m;
}

/** 이름 첫 글자 대문자화("sonnet" → "Sonnet") */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * 모델 ID → 짧은 표시명. 예: "claude-sonnet-5"→"Sonnet 5", "claude-opus-4-8"→"Opus 4.8",
 * "claude-haiku-4-5-20251001"→"Haiku 4.5", 구형 "claude-3-5-sonnet-20241022"→"Sonnet 3.5".
 * 미인식 ID는 원본 그대로(모델 ID는 수시로 바뀌므로 깨뜨리지 않는다).
 */
export function modelDisplayName(modelId: string): string {
  // 신형: claude-<이름>-<메이저>[-<마이너>][-<날짜8자리>]
  const m = modelId.match(/^claude-([a-z]+)-(\d+(?:-\d+)?)(?:-\d{8})?$/);
  if (m) return `${capitalize(m[1])} ${m[2].replace("-", ".")}`;
  // 구형: claude-<메이저>[-<마이너>]-<이름>[-<날짜8자리>]
  const legacy = modelId.match(/^claude-(\d)(?:-(\d))?-([a-z]+)(?:-\d{8})?$/);
  if (legacy) return `${capitalize(legacy[3])} ${legacy[1]}${legacy[2] ? `.${legacy[2]}` : ""}`;
  return modelId;
}

/** 모델 ID → 배지 색 클래스(모델 계열별) */
export function modelBadgeClass(modelId: string): string {
  for (const name of ["opus", "sonnet", "haiku", "fable"]) {
    if (modelId.includes(name)) return `bdg-model-${name}`;
  }
  return "bdg-model-unknown";
}
