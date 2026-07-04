import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let homeDir = "";
let previousHome = "";
let previousUserProfile = "";
let previousHomeDrive = "";
let previousHomePath = "";

async function loadRecallModule() {
  return import("./recall.js");
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function writeText(filePath: string, value: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, "utf8");
}

beforeEach(async () => {
  previousHome = process.env.HOME ?? "";
  previousUserProfile = process.env.USERPROFILE ?? "";
  previousHomeDrive = process.env.HOMEDRIVE ?? "";
  previousHomePath = process.env.HOMEPATH ?? "";
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-recall-"));
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

describe("recall provider-prefixed Claude ids", () => {
  it("prefixes workspace ids while reading v2 board state", async () => {
    const projectId = "D--repo";
    const sessionId = "session-a";
    const transcript = [
      JSON.stringify({
        type: "user",
        message: { content: "workspace question" },
        cwd: "C:/work/repo",
        sessionId,
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "workspace answer" }], model: "claude-sonnet-5" },
        cwd: "C:/work/repo",
        sessionId,
      }),
    ].join("\n");
    await writeText(path.join(homeDir, ".claude", "projects", projectId, `${sessionId}.jsonl`), transcript);
    await writeJson(path.join(homeDir, ".harness-manager", "board.json"), {
      schemaVersion: 2,
      projects: {
        "claude:D--repo": { memo: "prefixed board memo", status: "보류" },
      },
      plans: {},
      sessions: {},
    });

    const { getWorkspaceProjects } = await loadRecallModule();
    const projects = await getWorkspaceProjects();

    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe("claude:D--repo");
    expect(projects[0].memberIds).toEqual(["claude:D--repo"]);
    expect(projects[0].board.memo).toBe("prefixed board memo");
    expect(projects[0].board.status).toBe("보류");
  });

  it("accepts prefixed project ids for session lookup and prefixes timeline ids", async () => {
    const projectId = "D--repo";
    const sessionId = "session-a";
    const transcript = [
      JSON.stringify({
        type: "ai-title",
        aiTitle: "Resume work",
      }),
      JSON.stringify({
        type: "user",
        message: { content: "timeline question" },
        cwd: "C:/work/repo",
        sessionId,
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "timeline answer" }], model: "claude-sonnet-5" },
        cwd: "C:/work/repo",
        sessionId,
      }),
    ].join("\n");
    await writeText(path.join(homeDir, ".claude", "projects", projectId, `${sessionId}.jsonl`), transcript);
    await writeText(
      path.join(homeDir, ".claude", "plans", "plan-a.md"),
      `<!-- claude-session: ${sessionId} -->\n# Plan A\n`,
    );
    await writeJson(path.join(homeDir, ".harness-manager", "board.json"), {
      schemaVersion: 2,
      projects: {},
      plans: {},
      sessions: {
        "claude:session-a": { status: "완료" },
      },
    });

    const { getProjectSessions, getTimeline } = await loadRecallModule();
    const sessions = await getProjectSessions("claude:D--repo");
    const timeline = await getTimeline();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe("session-a");

    const sessionEvent = timeline.find((e) => e.kind === "session");
    expect(sessionEvent).toMatchObject({
      projectId: "claude:D--repo",
      sessionId: "claude:session-a",
      status: "완료",
    });

    const planEvent = timeline.find((e) => e.kind === "plan");
    expect(planEvent).toMatchObject({
      projectId: "claude:D--repo",
      parentSessionId: "claude:session-a",
    });
  });
});
