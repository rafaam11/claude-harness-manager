export type ProviderId = "claude" | "codex";
export type ProviderFilter = ProviderId | "all";
export type EntityId = `${ProviderId}:${string}`;
export type SessionKind = "main" | "worker" | "imported" | "system" | "unknown";

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  running: boolean;
  roots: string[];
}

export interface NormalizedConfigFile {
  id: string;
  provider: ProviderId;
  label: string;
  path: string;
  format: "json" | "toml" | "markdown";
  scope: "user" | "project" | "app";
  writable: boolean;
}

export interface NormalizedSession {
  id: EntityId;
  provider: ProviderId;
  projectId?: EntityId;
  sessionKind: SessionKind;
  title?: string;
  cwd?: string;
  model?: string;
  startedAt?: string;
  updatedAt: string;
  turnCount?: number;
  lastUserText?: string;
  lastAssistantText?: string;
  sourcePath?: string;
}

export interface NormalizedProject {
  id: EntityId;
  provider: ProviderId;
  localId: string;
  title: string;
  realPath: string | null;
  latestActivityAt: string | null;
}

export interface NormalizedPlan {
  id: EntityId;
  provider: ProviderId;
  title: string;
  sourcePath: string;
  updatedAt: string;
  archived: boolean;
  projectId: EntityId | null;
}

export type NormalizedTimelineKind = "session" | "plan" | "memory" | "config" | "git";

export interface NormalizedTimelineEvent {
  id: EntityId;
  provider: ProviderId;
  kind: NormalizedTimelineKind;
  projectId: EntityId | null;
  title: string;
  updatedAt: string;
  sourcePath?: string;
  lastUserText?: string;
  lastAssistantText?: string;
  startedAt?: string;
  turnCount?: number;
  pinned?: boolean;
}

export type LiveSessionSource = "codex-rollout-lock" | "claude-hook";

/**
 * 살아있는 세션이 "지금 뭘 하는 중인지". transcript 마지막 줄에서 판별한다.
 * awaiting-* 는 사용자 액션(계획 승인·질문 답변)을 기다리느라 막혀 있다는 뜻이다.
 */
export type LiveActivityState = "working" | "idle" | "awaiting-approval" | "awaiting-input" | "unknown";

export interface SessionActivity {
  state: LiveActivityState;
  since: string | null; // 이 상태를 만든 transcript 줄의 timestamp(ISO)
  tool: string | null; // working일 때 마지막 tool_use 이름(예: "Edit")
}

export interface LiveSessionTodo {
  id: string;
  subject: string;
  status: string; // pending | in_progress | completed
  activeForm?: string;
}

export interface LiveSessionTodos {
  total: number;
  done: number;
  /** 지금 진행 중인 항목(activeForm ?? subject). 없으면 null. */
  active: string | null;
  items: LiveSessionTodo[];
}

/** 실제 터미널 프로세스 생존을 검증해 얻은 실행 중 세션. 수동 board 상태와 무관하다. */
export interface LiveSession {
  id: EntityId;
  provider: ProviderId;
  projectId: EntityId | null;
  sessionKind: SessionKind;
  title: string;
  cwd: string | null;
  model: string | null;
  updatedAt: string | null;
  detectedAt: string;
  source: LiveSessionSource;
  activity: SessionActivity;
  todos: LiveSessionTodos | null;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
}

export interface ClaudeLiveTrackingStatus {
  installed: boolean;
  /** 설치돼 있으나 예전 이벤트 구성(UserPromptSubmit 누락)이라 업그레이드가 필요한 상태. */
  outdated: boolean;
  hookPath: string;
}
