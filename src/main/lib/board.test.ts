import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let homeDir = "";
let previousHome = "";
let previousUserProfile = "";
let previousHomeDrive = "";
let previousHomePath = "";

async function loadBoardModule() {
  return import("./board.js");
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

beforeEach(async () => {
  previousHome = process.env.HOME ?? "";
  previousUserProfile = process.env.USERPROFILE ?? "";
  previousHomeDrive = process.env.HOMEDRIVE ?? "";
  previousHomePath = process.env.HOMEPATH ?? "";
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-board-"));
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.HOMEDRIVE = "";
  process.env.HOMEPATH = "";
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(homeDir, { recursive: true, force: true });
  if (previousHome) process.env.HOME = previousHome;
  else delete process.env.HOME;
  if (previousUserProfile) process.env.USERPROFILE = previousUserProfile;
  else delete process.env.USERPROFILE;
  if (previousHomeDrive) process.env.HOMEDRIVE = previousHomeDrive;
  else delete process.env.HOMEDRIVE;
  if (previousHomePath) process.env.HOMEPATH = previousHomePath;
  else delete process.env.HOMEPATH;
  homeDir = "";
});

describe("board migration", () => {
  it("prefixes legacy keys with claude provider", async () => {
    const { migrateBoard } = await loadBoardModule();
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

  it("keeps already-prefixed keys stable", async () => {
    const { migrateBoard } = await loadBoardModule();
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

describe("readBoard", () => {
  it("quarantines a corrupt v2 board and does not fall back to legacy state", async () => {
    const { readBoard } = await loadBoardModule();
    const v2Path = path.join(homeDir, ".harness-manager", "board.json");
    const legacyPath = path.join(homeDir, ".claude", "harness-manager", "board.json");
    await writeJson(legacyPath, {
      version: 1,
      projects: { "old-repo": { memo: "legacy" } },
      plans: { "old-plan.md": { status: "완료" } },
      sessions: { "old-session": { memo: "legacy-session" } },
    });
    await fs.mkdir(path.dirname(v2Path), { recursive: true });
    await fs.writeFile(v2Path, "{not-json", "utf8");

    const board = await readBoard();

    expect(board).toEqual({
      schemaVersion: 2,
      plans: {},
      projects: {},
      sessions: {},
    });
    expect(await fs.readFile(legacyPath, "utf8")).toContain("legacy");
    const quarantined = await fs.readdir(path.dirname(v2Path));
    expect(quarantined.some((name) => name.startsWith("board.json.corrupt."))).toBe(true);
  });

  it("migrates legacy state when v2 is missing", async () => {
    const { readBoard } = await loadBoardModule();
    const legacyPath = path.join(homeDir, ".claude", "harness-manager", "board.json");
    await writeJson(legacyPath, {
      version: 1,
      projects: { "old-repo": { memo: "legacy" } },
      plans: { "old-plan.md": { status: "완료" } },
      sessions: { "old-session": { memo: "legacy-session" } },
    });

    const board = await readBoard();

    expect(board.schemaVersion).toBe(2);
    expect(board.projects["claude:old-repo"]?.memo).toBe("legacy");
    expect(board.plans["claude:old-plan.md"]?.status).toBe("완료");
    expect(board.sessions["claude:old-session"]?.memo).toBe("legacy-session");
  });

  it("does not quarantine or rename a corrupt legacy board when v2 is missing", async () => {
    const { readBoard } = await loadBoardModule();
    const legacyPath = path.join(homeDir, ".claude", "harness-manager", "board.json");
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, "{not-json", "utf8");

    const board = await readBoard();

    expect(board).toEqual({
      schemaVersion: 2,
      plans: {},
      projects: {},
      sessions: {},
    });
    expect(await fs.readFile(legacyPath, "utf8")).toBe("{not-json");
    const legacyDir = await fs.readdir(path.dirname(legacyPath));
    expect(legacyDir.some((name) => name.startsWith("board.json.corrupt."))).toBe(false);
  });
});

describe("setPlanField", () => {
  it("edits the migrated claude-prefixed plan key instead of creating a stale raw duplicate", async () => {
    const { setPlanField } = await loadBoardModule();
    const legacyPath = path.join(homeDir, ".claude", "harness-manager", "board.json");
    await writeJson(legacyPath, {
      version: 1,
      plans: { "old-plan.md": { status: "완료" } },
      projects: {},
      sessions: {},
    });

    const board = await setPlanField("old-plan.md", { memo: "edited" });

    expect(board.plans["claude:old-plan.md"]).toEqual({
      status: "완료",
      memo: "edited",
    });
    expect(board.plans["old-plan.md"]).toBeUndefined();
  });
});
