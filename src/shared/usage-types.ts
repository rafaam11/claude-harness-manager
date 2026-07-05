import type { ProviderId } from "./provider-types.js";

export type UsageQuotaSource = "codex-log" | "claude-statusline" | "unavailable";

export interface UsageQuotaWindow {
  usedPercent: number | null;
  windowMinutes: number;
  resetAt: string | null;
}

export interface UsageQuotaSummary {
  source: UsageQuotaSource;
  observedAt: string | null;
  stale: boolean;
  planType: string | null;
  fiveHour: UsageQuotaWindow;
  weekly: UsageQuotaWindow;
  message?: string;
}

export interface UsageTokenWindow {
  since: string;
  until: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  eventCount: number;
}

export interface UsageTokenSummary {
  fiveHour: UsageTokenWindow;
  weekly: UsageTokenWindow;
}

export interface UsageCaptureStatus {
  provider: "claude";
  enabled: boolean;
  settingsPath: string;
  snapshotPath: string;
  proxyPath: string;
  proxyCommand: string;
  originalCommand: string | null;
  changed: boolean;
  conflict?: boolean;
  message?: string;
}

export interface UsageSummary {
  provider: ProviderId;
  label: string;
  quota: UsageQuotaSummary;
  tokens: UsageTokenSummary;
  capture?: UsageCaptureStatus;
  errors: string[];
}
