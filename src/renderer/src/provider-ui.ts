import type { ProviderFilter, ProviderId } from "@shared/provider-types";

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
