import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCleanupCategory,
  assertInsideRoot,
  assertSafePathSegment,
  assertSafeRelativePath,
} from "./path-scope.js";

describe("path scope guards", () => {
  it("allows a child inside the intended root", () => {
    const root = path.resolve("root");
    const child = path.join(root, "a", "b.txt");
    expect(assertInsideRoot(child, root, "project")).toBe(path.resolve(child));
  });

  it("rejects a sibling with the same prefix", () => {
    const root = path.resolve("root");
    const sibling = path.resolve("root-evil", "x.txt");
    expect(() => assertInsideRoot(sibling, root, "project")).toThrow(/project/);
  });

  it("rejects unsafe path segments", () => {
    expect(() => assertSafePathSegment("../x", "project id")).toThrow(/project id/);
    expect(() => assertSafePathSegment("a/b", "project id")).toThrow(/project id/);
    expect(assertSafePathSegment("D--repo-name", "project id")).toBe("D--repo-name");
  });

  it("rejects relative paths that escape their root", () => {
    expect(() => assertSafeRelativePath("../settings.json", "project file")).toThrow(
      /project file/,
    );
    expect(assertSafeRelativePath("memory/session.jsonl", "project file")).toBe(
      "memory/session.jsonl",
    );
  });

  it("allows only cleanup categories produced by scanCandidates", () => {
    expect(assertCleanupCategory("projects")).toBe("projects");
    expect(assertCleanupCategory("temp/session-env")).toBe("temp/session-env");
    expect(() => assertCleanupCategory("../../escape")).toThrow(/cleanup category/);
    expect(() => assertCleanupCategory("warn-only")).toThrow(/cleanup category/);
  });
});
