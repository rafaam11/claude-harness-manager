import { describe, expect, it } from "vitest";
import { parseWindowsLockProbe, parseWindowsProcessProbe } from "./live-sessions.js";

describe("live session process probes", () => {
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

  it("requires the process probe to explicitly confirm a matching PID and start token", () => {
    expect(
      parseWindowsProcessProbe(JSON.stringify([{ id: "claude:one", running: true }, { id: "claude:old", running: false }])),
    ).toEqual(new Set(["claude:one"]));
    expect(parseWindowsProcessProbe(JSON.stringify({ id: "claude:only", running: true }))).toEqual(
      new Set(["claude:only"]),
    );
  });
});
