import { describe, expect, it } from "vitest";
import { migrateBoard } from "./board.js";

describe("board migration", () => {
  it("prefixes legacy keys with claude provider", () => {
    const migrated = migrateBoard({
      version: 1,
      projects: { "D--repo": { memo: "x" } },
      plans: { "plan.md": { status: "완료" } },
      sessions: { "session-1": { memo: "s" } },
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.projects["claude:D--repo"]?.memo).toBe("x");
    expect(migrated.plans["claude:plan.md"]?.status).toBe("완료");
    expect(migrated.sessions["claude:session-1"]?.memo).toBe("s");
  });

  it("keeps already-prefixed keys stable", () => {
    const migrated = migrateBoard({
      schemaVersion: 2,
      projects: { "codex:repo": { memo: "c" } },
      plans: {},
      sessions: {},
      migratedFrom: "legacy",
      migratedAt: "2026-07-04T00:00:00.000Z",
    });
    expect(migrated.projects["codex:repo"]?.memo).toBe("c");
  });
});
