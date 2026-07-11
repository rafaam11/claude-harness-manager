import { describe, expect, it } from "vitest";
import { parseWindowsLockProbe } from "./live-sessions.js";

describe("live session lock probes", () => {
  it("returns only rollout paths whose restrictive read probe was blocked", () => {
    expect(
      parseWindowsLockProbe(
        JSON.stringify([
          { path: "C:\\sessions\\active.jsonl", locked: true },
          { path: "C:\\sessions\\closed.jsonl", locked: false },
          { path: 3, locked: true },
        ]),
      ),
    ).toEqual(new Set(["C:\\sessions\\active.jsonl"]));
    expect(parseWindowsLockProbe(JSON.stringify({ path: "C:\\sessions\\only.jsonl", locked: true }))).toEqual(
      new Set(["C:\\sessions\\only.jsonl"]),
    );
  });
});
