import { describe, expect, it } from "vitest";
import { validateConfigContent } from "./config-write.js";

describe("config content validation", () => {
  it("validates JSON descriptors with existing JSON rules", () => {
    expect(() =>
      validateConfigContent({ id: "settings", format: "json" }, JSON.stringify({ hooks: {} })),
    ).not.toThrow();
  });

  it("validates TOML descriptors", () => {
    expect(() =>
      validateConfigContent({ id: "codex-config", format: "toml" }, 'model = "gpt-5.5"\n'),
    ).not.toThrow();
  });

  it("rejects Markdown writes", () => {
    expect(() => validateConfigContent({ id: "agents", format: "markdown" }, "# x")).toThrow(
      /read-only/,
    );
  });
});
