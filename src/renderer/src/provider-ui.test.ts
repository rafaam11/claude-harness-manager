import { describe, expect, it } from "vitest";
import { PROVIDER_FILTER_OPTIONS } from "./provider-ui";

describe("provider filter options", () => {
  it("uses compact stacked labels for the provider switcher", () => {
    expect(PROVIDER_FILTER_OPTIONS.map((option) => option.label)).toEqual([
      "All",
      "Claude",
      "Codex",
    ]);
  });
});
