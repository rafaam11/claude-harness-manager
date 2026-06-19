import os from "node:os";
import path from "node:path";

export const CLAUDE_HOME = path.join(os.homedir(), ".claude");
export const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");

// 모든 파일 연산이 허용되는 경로. path-guard가 이 목록으로 검사한다.
export const ALLOWED_ROOTS = [CLAUDE_HOME, CLAUDE_JSON];

export const BACKUP_DIR = path.join(CLAUDE_HOME, "backups", "harness-manager");
export const BACKUP_KEEP = 20;

export const ARCHIVE_ROOT = path.join(CLAUDE_HOME, "archive");

export const STALE_DAYS = 30;
export const AGENT_SIZE_WARN_BYTES = 19 * 1024;

// 편집 가능한 설정 파일. claude-json은 MVP에서 읽기 전용 (CC가 상시 재작성).
export const CONFIG_FILES: Record<string, { path: string; writable: boolean }> = {
  settings: { path: path.join(CLAUDE_HOME, "settings.json"), writable: true },
  "settings-local": { path: path.join(CLAUDE_HOME, "settings.local.json"), writable: true },
  "claude-json": { path: CLAUDE_JSON, writable: false },
};

export const TEMP_DIRS = [
  "session-env",
  "plans",
  "file-history",
  "paste-cache",
  "shell-snapshots",
];

// --- Workspace 대시보드 ---
export const PROJECTS_DIR = path.join(CLAUDE_HOME, "projects");
export const PLANS_DIR = path.join(CLAUDE_HOME, "plans");
export const PLANS_ARCHIVE_DIR = path.join(PLANS_DIR, "_archive");
export const HISTORY_FILE = path.join(CLAUDE_HOME, "history.jsonl");
export const TASKS_DIR = path.join(CLAUDE_HOME, "tasks");
// 앱 소유 수동 레이어(상태/메모/연결 override). ~/.claude 하위라 allowlist 통과.
export const BOARD_FILE = path.join(CLAUDE_HOME, "harness-manager", "board.json");

// transcript 끝에서 이만큼만 읽어 ai-title/last-prompt/마지막 응답을 추출한다.
export const RECALL_TAIL_BYTES = 512 * 1024;
// tail에 신호가 전무할 때만 readline 스트리밍 폴백을 허용하는 상한.
export const RECALL_MAX_FULL_SCAN_BYTES = 8 * 1024 * 1024;
// 무거운 스캔(recall/plans/history) 결과 캐시 수명.
export const WORKSPACE_CACHE_TTL_MS = 5000;
// 계획 파일 mtime과 history 기록의 시각차가 이 안이면 같은 프로젝트로 추정.
export const PLAN_GUESS_WINDOW_MS = 6 * 60 * 60 * 1000;
