import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs node-side TypeScript tests", () => {
    expect(pathSepExample("a", "b")).toBe("a/b");
  });
});

function pathSepExample(left: string, right: string): string {
  return `${left}/${right}`;
}
