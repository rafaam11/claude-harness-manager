import type { ProviderFilter, ProviderId } from "@shared/provider-types";

export const DEFAULT_PROVIDER_FILTER: ProviderFilter = "all";

export interface ProviderFilterOption {
  value: ProviderFilter;
  label: string;
  fullLabel: string;
}

export const PROVIDER_FILTER_OPTIONS: ProviderFilterOption[] = [
  { value: "all", label: "All", fullLabel: "All providers" },
  { value: "claude", label: "Claude", fullLabel: "Claude Code" },
  { value: "codex", label: "Codex", fullLabel: "Codex" },
];

export function providerToneClass(provider: ProviderFilter | ProviderId): string {
  return provider === "all" ? "provider-all" : `provider-${provider}`;
}

export function providerGroupLabel(provider: ProviderId): string {
  return provider === "claude" ? "Claude Code" : "Codex";
}

export function groupRowsByProvider<T extends { provider?: ProviderId }>(
  rows: T[],
): { provider: ProviderId; rows: T[] }[] {
  const order: ProviderId[] = ["claude", "codex"];
  return order
    .map((provider) => ({ provider, rows: rows.filter((row) => row.provider === provider) }))
    .filter((group) => group.rows.length > 0);
}
