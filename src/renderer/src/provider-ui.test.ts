import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_FILTER, PROVIDER_FILTER_OPTIONS, groupRowsByProvider, providerGroupLabel } from "./provider-ui";

describe("provider filter options", () => {
  it("defaults to all providers so Claude and Codex are visible together", () => {
    expect(DEFAULT_PROVIDER_FILTER).toBe("all");
  });

  it("uses compact stacked labels for the provider switcher", () => {
    expect(PROVIDER_FILTER_OPTIONS.map((option) => option.label)).toEqual([
      "All",
      "Claude",
      "Codex",
    ]);
  });

  it("groups mixed rows under stable Claude and Codex labels", () => {
    const groups = groupRowsByProvider([
      { provider: "codex" as const, id: "codex-config" },
      { provider: "claude" as const, id: "settings" },
      { provider: "codex" as const, id: "codex-profile" },
    ]);

    expect(groups.map((g) => [providerGroupLabel(g.provider), g.rows.map((r) => r.id)])).toEqual([
      ["Claude Code", ["settings"]],
      ["Codex", ["codex-config", "codex-profile"]],
    ]);
  });
});
