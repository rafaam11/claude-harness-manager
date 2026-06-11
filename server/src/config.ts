import os from "node:os";
import path from "node:path";

export const CLAUDE_HOME = path.join(os.homedir(), ".claude");
export const CLAUDE_JSON = path.join(os.homedir(), ".claude.json");

export const HOST = "127.0.0.1";
export const PORT = 7860;

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
