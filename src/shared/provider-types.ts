export type ProviderId = "claude" | "codex";
export type ProviderFilter = ProviderId | "all";
export type EntityId = `${ProviderId}:${string}`;
export type SessionKind = "main" | "worker" | "system" | "unknown";

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
}
