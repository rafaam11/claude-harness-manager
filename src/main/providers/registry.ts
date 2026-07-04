import type { EntityId, ProviderFilter, ProviderId } from "@shared/provider-types";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import type { ProviderAdapter } from "./types.js";

const providers: Record<ProviderId, ProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
};

export function parseProviderFilter(filter: string | undefined): ProviderFilter | null {
  if (!filter) return "all";
  if (filter === "all" || filter === "claude" || filter === "codex") return filter;
  return null;
}

export function getProvider(id: ProviderId): ProviderAdapter {
  return providers[id];
}

export function getProviders(filter: ProviderFilter = "all"): ProviderAdapter[] {
  if (filter === "all") return [providers.claude, providers.codex];
  return [providers[filter]];
}

export function prefixEntityId(provider: ProviderId, localId: string): EntityId {
  return `${provider}:${localId}`;
}

export function splitEntityId(id: string): { provider: ProviderId; localId: string } {
  const idx = id.indexOf(":");
  const provider = id.slice(0, idx);
  const localId = id.slice(idx + 1);
  if ((provider === "claude" || provider === "codex") && localId) {
    return { provider, localId };
  }
  return { provider: "claude", localId: id };
}
