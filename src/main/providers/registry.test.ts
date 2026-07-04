import { describe, expect, it } from "vitest";
import {
  getProvider,
  getProviders,
  parseProviderFilter,
  prefixEntityId,
  splitEntityId,
} from "./registry.js";

describe("provider registry", () => {
  it("returns registered providers", () => {
    expect(getProvider("claude").id).toBe("claude");
    expect(getProvider("codex").id).toBe("codex");
    expect(getProviders("all").map((p) => p.id)).toEqual(["claude", "codex"]);
  });

  it("parses provider filters and rejects invalid values", () => {
    expect(parseProviderFilter(undefined)).toBe("all");
    expect(parseProviderFilter("all")).toBe("all");
    expect(parseProviderFilter("claude")).toBe("claude");
    expect(parseProviderFilter("codex")).toBe("codex");
    expect(parseProviderFilter("bogus")).toBeNull();
  });

  it("prefixes and splits entity ids", () => {
    expect(prefixEntityId("codex", "abc")).toBe("codex:abc");
    expect(splitEntityId("claude:D--repo")).toEqual({ provider: "claude", localId: "D--repo" });
  });
});
