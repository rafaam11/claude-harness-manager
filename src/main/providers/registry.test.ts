import { describe, expect, it } from "vitest";
import { getProvider, getProviders, prefixEntityId, splitEntityId } from "./registry.js";

describe("provider registry", () => {
  it("returns registered providers", () => {
    expect(getProvider("claude").id).toBe("claude");
    expect(getProvider("codex").id).toBe("codex");
    expect(getProviders("all").map((p) => p.id)).toEqual(["claude", "codex"]);
  });

  it("prefixes and splits entity ids", () => {
    expect(prefixEntityId("codex", "abc")).toBe("codex:abc");
    expect(splitEntityId("claude:D--repo")).toEqual({ provider: "claude", localId: "D--repo" });
  });
});
