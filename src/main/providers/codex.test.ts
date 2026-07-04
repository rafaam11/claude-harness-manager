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
          writable: true,
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
});
