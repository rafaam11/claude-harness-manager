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
  plans: { filename: string; title: string; status: BoardStatus; archived: boolean }[];
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
