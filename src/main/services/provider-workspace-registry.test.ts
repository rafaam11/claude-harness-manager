import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let homeDir = "";
let previousHome: string | undefined;
let previousUserProfile: string | undefined;
let previousCodeHome: string | undefined;

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

beforeEach(async () => {
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  previousCodeHome = process.env.CODEX_HOME;
  homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-provider-registry-"));
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.CODEX_HOME = path.join(homeDir, ".codex");
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(homeDir, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  if (previousCodeHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodeHome;
  homeDir = "";
});

describe("provider workspace project registry integration", () => {
  it("migrates board project metadata on first discovery and returns the stable registry UUID", async () => {
    const localProjectId = "D--repo";
    const sessionId = "session-registry";
    const transcript = [
      JSON.stringify({
        type: "user",
        message: { content: "continue shared work" },
        cwd: "C:/work/repo",
        sessionId,
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "ready" }], model: "claude-sonnet-5" },
        cwd: "C:/work/repo",
        sessionId,
      }),
    ].join("\n");
    await writeText(
      path.join(homeDir, ".claude", "projects", localProjectId, `${sessionId}.jsonl`),
      transcript,
    );
    const boardPath = path.join(homeDir, ".harness-manager", "board.json");
    const boardText = `${JSON.stringify(
      {
        schemaVersion: 2,
        plans: { "claude:plan.md": { memo: "keep plan" } },
        projects: {
          [`claude:${localProjectId}`]: {
            status: "보류",
            memo: "migrated memo",
            nameOverride: "Migrated name",
            tracks: [{ id: "track", title: "Next", items: [] }],
          },
        },
        sessions: { "claude:session": { memo: "keep session" } },
      },
      null,
      2,
    )}\n`;
    await writeText(boardPath, boardText);

    const { getProviderWorkspaceProjects } = await import("./provider-workspace.js");
    const projects = await getProviderWorkspaceProjects("claude");

    expect(projects).toHaveLength(1);
    expect(projects[0].registryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(projects[0].board).toMatchObject({
      status: "보류",
      memo: "migrated memo",
      nameOverride: "Migrated name",
      tracks: [{ id: "track" }],
    });
    const registry = JSON.parse(
      await fs.readFile(path.join(homeDir, ".harness-manager", "projects.json"), "utf8"),
    ) as { migratedFromBoardAt?: string; projects: Record<string, { providerRefs: { claude: string[] } }> };
    expect(registry.migratedFromBoardAt).toBeTruthy();
    expect(Object.values(registry.projects)[0].providerRefs.claude).toEqual([localProjectId]);
    expect(await fs.readFile(boardPath, "utf8")).toBe(boardText);

    const registryPath = path.join(homeDir, ".harness-manager", "projects.json");
    const registryText = await fs.readFile(registryPath, "utf8");
    await getProviderWorkspaceProjects("claude");
    expect(await fs.readFile(registryPath, "utf8")).toBe(registryText);
    expect(await fs.access(`${registryPath}.bak`).then(() => true).catch(() => false)).toBe(false);

    const firstRegistryId = projects[0].registryId!;
    const { updateProjectRegistry } = await import("../lib/project-registry.js");
    await updateProjectRegistry((current) => {
      current.projects[firstRegistryId].memo = "new primary memo";
    });
    await fs.writeFile(registryPath, "{not-json", "utf8");

    const recovered = await getProviderWorkspaceProjects("claude");
    expect(recovered[0].registryId).toBe(firstRegistryId);
    expect(recovered[0].board.memo).toBe("migrated memo");
    expect(await fs.readFile(registryPath, "utf8")).toBe("{not-json");
  });
});
