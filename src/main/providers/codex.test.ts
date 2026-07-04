import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let homeDir = "";
let previousHome = "";
let previousUserProfile = "";
let previousHomeDrive = "";
let previousHomePath = "";

async function loadCodexProvider() {
  return import("./codex.js");
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
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-codex-"));
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

describe("codex provider", () => {
  it("lists config files, MCP servers, and read-only local catalog surfaces", async () => {
    const codexHome = path.join(homeDir, ".codex");
    await writeText(
      path.join(codexHome, "config.toml"),
      'model = "gpt-5.5"\n[mcp_servers.context7]\ncommand = "npx"\n',
    );
    await writeText(path.join(codexHome, "work.config.toml"), 'model = "gpt-5-mini"\n');
    await writeText(path.join(codexHome, "AGENTS.md"), "# Agents\n");
    await writeText(path.join(codexHome, "AGENTS.override.md"), "# Override\n");
    await writeText(path.join(codexHome, "memories", "memory_summary.md"), "# Summary\n");
    await writeText(path.join(codexHome, "memories", "MEMORY.md"), "# Memory\n");

    const { codexProvider } = await loadCodexProvider();
    const files = await codexProvider.listConfigFiles();
    const servers = await codexProvider.readMcpServers();
    const catalog = await codexProvider.listCatalog();

    expect(files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex-config",
          format: "toml",
          writable: true,
          label: "config.toml",
        }),
        expect.objectContaining({
          id: "codex-profile:work.config.toml",
          format: "toml",
          writable: false,
          label: "work.config.toml",
        }),
      ]),
    );
    expect(servers).toMatchObject([
      { name: "context7", scope: "user", transport: "stdio", command: "npx" },
    ]);
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "AGENTS.md",
          kind: "command",
          description: "Codex instruction file",
        }),
        expect.objectContaining({
          name: "AGENTS.override.md",
          kind: "command",
          description: "Codex instruction file",
        }),
        expect.objectContaining({
          name: "memory_summary.md",
          kind: "skill",
          description: "Codex memory file",
        }),
        expect.objectContaining({
          name: "MEMORY.md",
          kind: "skill",
          description: "Codex memory file",
        }),
      ]),
    );
  });

  it("lists Codex rollout sessions grouped by cwd instead of only memory files", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "07",
      "04",
      "rollout-2026-07-04T09-26-03-019f2a84-a3f8-73e3-a3ea-3cca10a8fcbd.jsonl",
    );
    await writeText(
      sessionPath,
      [
        JSON.stringify({
          timestamp: "2026-07-04T00:26:08.136Z",
          type: "session_meta",
          payload: {
            session_id: "019f2a84-a3f8-73e3-a3ea-3cca10a8fcbd",
            cwd: "C:\\Users\\uiop3\\Desktop\\3_Hobby_ws\\harness-manager",
            model: "gpt-5.5",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-04T00:27:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Provider UI를 고쳐줘" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-04T00:28:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "수정했습니다." }],
          },
        }),
      ].join("\n"),
    );
    await fs.utimes(sessionPath, new Date("2026-07-04T00:28:00.000Z"), new Date("2026-07-04T00:28:00.000Z"));

    const { codexProvider } = await loadCodexProvider();
    const projects = await codexProvider.listProjects();
    const sessions = await codexProvider.listSessions();

    expect(projects).toEqual([
      expect.objectContaining({
        id: "codex:C--Users-uiop3-Desktop-3_Hobby_ws-harness-manager",
        localId: "C--Users-uiop3-Desktop-3_Hobby_ws-harness-manager",
        title: "harness-manager",
        realPath: "C:\\Users\\uiop3\\Desktop\\3_Hobby_ws\\harness-manager",
        latestActivityAt: "2026-07-04T00:28:00.000Z",
      }),
    ]);
    expect(sessions).toEqual([
      expect.objectContaining({
        id: "codex:019f2a84-a3f8-73e3-a3ea-3cca10a8fcbd",
        projectId: "codex:C--Users-uiop3-Desktop-3_Hobby_ws-harness-manager",
        title: "Provider UI를 고쳐줘",
        cwd: "C:\\Users\\uiop3\\Desktop\\3_Hobby_ws\\harness-manager",
        model: "gpt-5.5",
        lastUserText: "Provider UI를 고쳐줘",
        lastAssistantText: "수정했습니다.",
        updatedAt: "2026-07-04T00:28:00.000Z",
      }),
    ]);
  });
});
