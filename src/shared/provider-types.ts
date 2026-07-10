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
}

export interface ClaudeLiveTrackingStatus {
  installed: boolean;
  hookPath: string;
}
