import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectRegistryLockTimeoutError,
  migrateBoardProjectsToRegistry,
  overlayProjectRegistryOnBoard,
  readProjectRegistry,
  reconcileDiscoveredProjects,
  setRegistryProjectsField,
  setRegistryProjectsOrder,
  setRegistryProjectsVisibility,
  updateProjectRegistry,
  validateProjectRegistry,
} from "./project-registry.js";

const temporaryDirectories: string[] = [];
const childProcesses = new Set<ChildProcess>();

async function temporaryRegistryPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "harness-project-registry-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "projects.json");
}

afterEach(async () => {
  for (const child of childProcesses) child.kill();
  childProcesses.clear();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      childProcesses.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`child exited ${code}: ${stderr}`));
    });
  });
}

function waitForOutput(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes(expected)) {
        child.stdout?.off("data", onData);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes(expected)) reject(new Error(`child exited ${code} before output: ${expected}`));
    });
  });
}

function spawnRegistryWriter(filePath: string, projectId: string, delayMs: number): ChildProcess {
  const fixturePath = fileURLToPath(new URL("test-fixtures/project-registry-writer.ts", import.meta.url));
  const viteNodePath = path.join(process.cwd(), "node_modules", "vite-node", "vite-node.mjs");
  const timestamp = "2026-07-11T12:00:00.000Z";
  const child = spawn(
    process.execPath,
    [viteNodePath, "--config", path.join(process.cwd(), "vitest.config.ts"), fixturePath],
    {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROJECT_REGISTRY_WRITER_PAYLOAD: JSON.stringify({
        filePath,
        delayMs,
        project: {
          id: projectId,
          rootPath: path.join(path.dirname(filePath), projectId),
          displayName: null,
          sources: ["manual"],
          providerRefs: { claude: [], codex: [] },
          status: null,
          memo: projectId,
          tracks: [],
          hidden: false,
          order: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      }),
    },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  childProcesses.add(child);
  return child;
}

describe("project registry validation", () => {
  it("accepts the exact v1 wire contract and rejects unknown fields", () => {
    const projectId = "61d98fcb-9c8d-4f8b-9e6f-723555a24a71";
    const registry = {
      schemaVersion: 1,
      updatedAt: "2026-07-11T12:00:00.000Z",
      projects: {
        [projectId]: {
          id: projectId,
          rootPath: "C:\\work\\repo",
          displayName: "Shared repo",
          sources: ["claude", "codex"],
          providerRefs: {
            claude: ["C--work-repo"],
            codex: ["codex:C--work-repo"],
          },
          status: "진행중",
          memo: "next step",
          tracks: [
            {
              id: "track-1",
              title: "MVP",
              items: [{ id: "todo-1", text: "wire registry", done: false }],
            },
          ],
          hidden: false,
          order: 1,
          createdAt: "2026-07-11T12:00:00.000Z",
          updatedAt: "2026-07-11T12:00:00.000Z",
        },
      },
    };

    expect(validateProjectRegistry(registry)).toEqual(registry);
    expect(() => validateProjectRegistry({ ...registry, extra: true })).toThrow(/unknown/i);
    expect(() =>
      validateProjectRegistry({
        ...registry,
        projects: {
          [projectId]: { ...registry.projects[projectId], extra: true },
        },
      }),
    ).toThrow(/unknown/i);
    expect(
      validateProjectRegistry({
        ...registry,
        projects: {
          [projectId]: { ...registry.projects[projectId], displayName: "" },
        },
      }).projects[projectId].displayName,
    ).toBe("");
    for (const order of [-1, 1.5]) {
      expect(() =>
        validateProjectRegistry({
          ...registry,
          projects: {
            [projectId]: { ...registry.projects[projectId], order },
          },
        }),
      ).toThrow(/order/i);
    }
    for (const providerRefs of [
      { claude: ["claude:C--work-repo"], codex: ["codex:C--work-repo"] },
      { claude: ["other:C--work-repo"], codex: ["codex:C--work-repo"] },
      { claude: ["C--work-repo"], codex: ["C--work-repo"] },
    ]) {
      expect(() =>
        validateProjectRegistry({
          ...registry,
          projects: {
            [projectId]: { ...registry.projects[projectId], providerRefs },
          },
        }),
      ).toThrow(/providerRefs/i);
    }
    const secondId = "f93cc631-6460-4bca-8f09-a53510aada9d";
    const secondProject = {
      ...registry.projects[projectId],
      id: secondId,
      providerRefs: { claude: ["D--other"], codex: [] },
    };
    expect(() =>
      validateProjectRegistry({
        ...registry,
        projects: { ...registry.projects, [secondId]: secondProject },
      }),
    ).toThrow(/rootPath|duplicate/i);
    expect(() =>
      validateProjectRegistry({
        ...registry,
        projects: {
          ...registry.projects,
          [secondId]: {
            ...secondProject,
            rootPath: "D:\\other",
            providerRefs: { claude: ["C--work-repo"], codex: [] },
          },
        },
      }),
    ).toThrow(/providerRef|duplicate/i);
  });
});

describe("project path reconciliation", () => {
  it("reuses one stable UUID for missing Windows paths that differ only by case and separators", async () => {
    const filePath = await temporaryRegistryPath();
    const missingRoot = path.join(path.dirname(filePath), "Missing", "Repo");
    const now = () => new Date("2026-07-11T12:00:00.000Z");

    const first = await reconcileDiscoveredProjects(
      [
        {
          rootPath: missingRoot,
          source: "claude",
          providerRef: "C--missing-repo",
        },
        {
          rootPath: missingRoot.toUpperCase().replace(/\\/g, "/"),
          source: "codex",
          providerRef: "codex:C--missing-repo",
        },
      ],
      { filePath, now },
    );

    expect(Object.values(first.projects)).toHaveLength(1);
    const project = Object.values(first.projects)[0];
    expect(project.sources).toEqual(["claude", "codex"]);
    expect(project.providerRefs).toEqual({
      claude: ["C--missing-repo"],
      codex: ["codex:C--missing-repo"],
    });
    expect(await fs.stat(missingRoot).catch(() => null)).toBeNull();

    const second = await reconcileDiscoveredProjects(
      [{ rootPath: missingRoot, source: "claude", providerRef: "C--missing-repo" }],
      { filePath, now },
    );
    expect(Object.keys(second.projects)).toEqual([project.id]);
  });

  it("reassigns a conflicting provider alias to the rootPath match without leaving duplicates", async () => {
    const filePath = await temporaryRegistryPath();
    const timestamp = "2026-07-11T12:00:00.000Z";
    const firstId = "61d98fcb-9c8d-4f8b-9e6f-723555a24a71";
    const secondId = "f93cc631-6460-4bca-8f09-a53510aada9d";
    const makeProject = (id: string, rootPath: string, providerRef: string) => ({
      id,
      rootPath,
      displayName: null,
      sources: ["claude"],
      providerRefs: { claude: [providerRef], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const firstRoot = path.join(path.dirname(filePath), "first");
    const secondRoot = path.join(path.dirname(filePath), "second");
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: timestamp,
        projects: {
          [firstId]: makeProject(firstId, firstRoot, "C--first"),
          [secondId]: makeProject(secondId, secondRoot, "C--second"),
        },
      }),
      "utf8",
    );

    const reconciled = await reconcileDiscoveredProjects(
      [{ rootPath: firstRoot, source: "claude", providerRef: "C--second" }],
      { filePath },
    );

    expect(reconciled.projects[firstId].providerRefs.claude).toEqual(["C--first", "C--second"]);
    expect(reconciled.projects[secondId].providerRefs.claude).toEqual([]);
  });

  it("keeps the UUID and updates rootPath when only the provider alias matches", async () => {
    const filePath = await temporaryRegistryPath();
    const originalRoot = path.join(path.dirname(filePath), "original");
    const movedRoot = path.join(path.dirname(filePath), "moved");
    const first = await reconcileDiscoveredProjects(
      [{ rootPath: originalRoot, source: "claude", providerRef: "C--repo" }],
      { filePath },
    );
    const projectId = Object.keys(first.projects)[0];

    const moved = await reconcileDiscoveredProjects(
      [{ rootPath: movedRoot, source: "claude", providerRef: "C--repo" }],
      { filePath },
    );

    expect(Object.keys(moved.projects)).toEqual([projectId]);
    expect(moved.projects[projectId].rootPath).toBe(path.resolve(movedRoot));
  });
});

describe("project registry persistence", () => {
  it("backs up the latest valid snapshot before an atomic replacement", async () => {
    const filePath = await temporaryRegistryPath();
    const now = () => new Date("2026-07-11T12:00:00.000Z");
    const first = await reconcileDiscoveredProjects(
      [{ rootPath: path.join(path.dirname(filePath), "repo"), source: "manual" }],
      { filePath, now },
    );
    const projectId = Object.keys(first.projects)[0];

    await updateProjectRegistry(
      (registry) => {
        registry.projects[projectId].memo = "updated";
      },
      { filePath, now: () => new Date("2026-07-11T12:01:00.000Z") },
    );

    const current = await readProjectRegistry({ filePath });
    const backup = validateProjectRegistry(JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8")));
    expect(current.projects[projectId].memo).toBe("updated");
    expect(backup.projects[projectId].memo).toBe("");
    expect((await fs.readdir(path.dirname(filePath))).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("reads the valid backup after primary corruption and refuses to overwrite the malformed file", async () => {
    const filePath = await temporaryRegistryPath();
    const now = () => new Date("2026-07-11T12:00:00.000Z");
    const initial = await reconcileDiscoveredProjects(
      [{ rootPath: path.join(path.dirname(filePath), "repo"), source: "manual" }],
      { filePath, now },
    );
    const projectId = Object.keys(initial.projects)[0];
    await updateProjectRegistry(
      (registry) => {
        registry.projects[projectId].memo = "latest";
      },
      { filePath, now },
    );
    await fs.writeFile(filePath, "{not-json", "utf8");

    const recovered = await readProjectRegistry({ filePath });
    expect(recovered.projects[projectId].memo).toBe("");
    await expect(
      updateProjectRegistry(
        (registry) => {
          registry.projects[projectId].memo = "must not write";
        },
        { filePath, now },
      ),
    ).rejects.toThrow(/not valid JSON/i);
    expect(await fs.readFile(filePath, "utf8")).toBe("{not-json");
  });

  it("preserves a valid backup when primary corruption races with a failed replacement", async () => {
    const filePath = await temporaryRegistryPath();
    const now = () => new Date("2026-07-11T12:00:00.000Z");
    const initial = await reconcileDiscoveredProjects(
      [{ rootPath: path.join(path.dirname(filePath), "repo"), source: "manual" }],
      { filePath, now },
    );
    const projectId = Object.keys(initial.projects)[0];
    await updateProjectRegistry(
      (registry) => {
        registry.projects[projectId].memo = "latest valid primary";
      },
      { filePath, now },
    );
    const validBackup = await fs.readFile(`${filePath}.bak`, "utf8");
    const renameFile = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (path.resolve(String(to)) === path.resolve(filePath)) throw new Error("replace failed");
      return renameFile(from, to);
    });

    try {
      await expect(
        updateProjectRegistry(
          async (registry) => {
            registry.projects[projectId].memo = "must not lose backup";
            await fs.writeFile(filePath, "{not-json", "utf8");
          },
          { filePath, now },
        ),
      ).rejects.toThrow(/replace failed/i);
    } finally {
      renameSpy.mockRestore();
    }

    expect(await fs.readFile(filePath, "utf8")).toBe("{not-json");
    expect(await fs.readFile(`${filePath}.bak`, "utf8")).toBe(validBackup);
    expect((await readProjectRegistry({ filePath })).projects[projectId].memo).toBe("");
  });
});

describe("project registry cross-process locking", () => {
  it("waits for a writer in another process and merges against the latest snapshot", async () => {
    const filePath = await temporaryRegistryPath();
    const firstId = "d2b43a8e-35de-4d6c-b702-f8feceb301a8";
    const secondId = "af8941e6-e122-4f42-8a59-92ca9948cc1a";
    const first = spawnRegistryWriter(filePath, firstId, 300);
    const firstExit = waitForExit(first);
    await waitForOutput(first, "locked");

    const second = spawnRegistryWriter(filePath, secondId, 0);
    await Promise.all([firstExit, waitForExit(second)]);

    const registry = await readProjectRegistry({ filePath });
    expect(Object.keys(registry.projects).sort()).toEqual([firstId, secondId].sort());
  }, 10_000);

  it("times out without changing the registry while another process owns the lock", async () => {
    const filePath = await temporaryRegistryPath();
    await reconcileDiscoveredProjects(
      [{ rootPath: path.join(path.dirname(filePath), "repo"), source: "manual" }],
      { filePath },
    );
    const before = await fs.readFile(filePath, "utf8");
    const childScript = `
      const lockfile = require("proper-lockfile");
      (async () => {
        const release = await lockfile.lock(process.argv[1], {
          realpath: false,
          retries: 0,
          stale: 10000,
          update: 2000
        });
        process.send("locked");
        setTimeout(async () => { await release(); process.exit(0); }, 400);
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const holder = spawn(process.execPath, ["-e", childScript, filePath], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    childProcesses.add(holder);
    const holderExit = waitForExit(holder);
    await new Promise<void>((resolve, reject) => {
      holder.once("message", (message) => (message === "locked" ? resolve() : reject(new Error(String(message)))));
      holder.once("error", reject);
    });

    await expect(
      updateProjectRegistry(() => {}, { filePath, lockTimeoutMs: 75 }),
    ).rejects.toBeInstanceOf(ProjectRegistryLockTimeoutError);
    expect(await fs.readFile(filePath, "utf8")).toBe(before);
    await holderExit;
  }, 10_000);
});

describe("board project migration", () => {
  it("moves merged project metadata once, backs up board.json, and never rewrites the board", async () => {
    const filePath = await temporaryRegistryPath();
    const directory = path.dirname(filePath);
    const boardFilePath = path.join(directory, "board.json");
    const backupDir = path.join(directory, "backups");
    const rootPath = path.join(directory, "repo");
    const now = () => new Date("2026-07-11T12:00:00.000Z");
    const board = {
      schemaVersion: 2,
      plans: { "claude:plan.md": { status: "완료" } },
      projects: {
        "claude:C--repo": {
          status: "보관",
          memo: "Claude memo",
          nameOverride: "Claude name",
          tracks: [{ id: "claude-track", title: "Claude", items: [] }],
          hidden: true,
          order: 7,
        },
        "codex:C--repo": {
          status: "진행중",
          memo: "Codex memo",
          nameOverride: "Codex name",
          tracks: [{ id: "codex-track", title: "Codex", items: [] }],
          hidden: false,
          order: 2,
        },
      },
      sessions: { "claude:session": { memo: "keep session" } },
    };
    const boardText = `${JSON.stringify(board, null, 2)}\n`;
    await fs.writeFile(boardFilePath, boardText, "utf8");
    const discoveries = [
      { rootPath, source: "claude" as const, providerRef: "C--repo" },
      { rootPath, source: "codex" as const, providerRef: "codex:C--repo" },
    ];

    const migrated = await migrateBoardProjectsToRegistry(board.projects, discoveries, {
      filePath,
      boardFilePath,
      backupDir,
      now,
    });

    const project = Object.values(migrated.projects)[0];
    expect(migrated.migratedFromBoardAt).toBe("2026-07-11T12:00:00.000Z");
    expect(project).toMatchObject({
      displayName: "Claude name",
      status: "진행중",
      memo: "Claude memo",
      tracks: [{ id: "claude-track" }],
      hidden: false,
      order: 7,
    });
    expect(await fs.readFile(boardFilePath, "utf8")).toBe(boardText);
    const backups = await fs.readdir(backupDir);
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(path.join(backupDir, backups[0]), "utf8")).toBe(boardText);

    await updateProjectRegistry(
      (registry) => {
        registry.projects[project.id].memo = "shared edit";
      },
      { filePath, now: () => new Date("2026-07-11T12:01:00.000Z") },
    );
    board.projects["claude:C--repo"].memo = "stale legacy edit";
    const repeated = await migrateBoardProjectsToRegistry(board.projects, discoveries, {
      filePath,
      boardFilePath,
      backupDir,
      now: () => new Date("2026-07-11T12:02:00.000Z"),
    });
    expect(repeated.projects[project.id].memo).toBe("shared edit");
    expect(await fs.readdir(backupDir)).toHaveLength(1);
  });

  it("ignores provider session refs that are not legacy board project keys", async () => {
    const filePath = await temporaryRegistryPath();
    const directory = path.dirname(filePath);
    const rootPath = path.join(directory, "repo");
    await reconcileDiscoveredProjects(
      [{ rootPath, source: "claude", providerRef: "raw-session-uuid" }],
      { filePath },
    );

    const migrated = await migrateBoardProjectsToRegistry(
      {
        "claude:C--repo": { status: "보관", hidden: true, order: -1 },
        "codex:C--repo": { status: "보관", hidden: true, order: 2 },
      },
      [
        { rootPath, source: "claude", providerRef: "C--repo" },
        { rootPath, source: "codex", providerRef: "codex:C--repo" },
      ],
      { filePath, boardFilePath: path.join(directory, "missing-board.json") },
    );

    expect(Object.values(migrated.projects)[0]).toMatchObject({
      status: "보관",
      hidden: true,
      order: 2,
    });
  });

  it("preserves existing shared fields while filling each untouched field from the legacy board", async () => {
    const filePath = await temporaryRegistryPath();
    const directory = path.dirname(filePath);
    const rootPath = path.join(directory, "repo");
    const discovered = await reconcileDiscoveredProjects(
      [{ rootPath, source: "claude", providerRef: "C--repo" }],
      { filePath },
    );
    const projectId = Object.keys(discovered.projects)[0];
    await setRegistryProjectsField(
      [projectId],
      { nameOverride: "Shared custom name" },
      { filePath },
    );

    const migrated = await migrateBoardProjectsToRegistry(
      {
        "claude:C--repo": {
          status: "보류",
          memo: "legacy memo",
          nameOverride: "Legacy name",
          tracks: [{ id: "track", title: "Legacy", items: [] }],
          hidden: true,
          order: 6,
        },
      },
      [{ rootPath, source: "claude", providerRef: "C--repo" }],
      { filePath, boardFilePath: path.join(directory, "missing-board.json") },
    );

    expect(migrated.projects[projectId]).toMatchObject({
      displayName: "Shared custom name",
      status: "보류",
      memo: "legacy memo",
      tracks: [{ id: "track" }],
      hidden: true,
      order: 6,
    });
  });
});

describe("registry-backed project reads", () => {
  it("replaces stale board project fields for every provider reference", () => {
    const projectId = "61d98fcb-9c8d-4f8b-9e6f-723555a24a71";
    const timestamp = "2026-07-11T12:00:00.000Z";
    const board = {
      schemaVersion: 2 as const,
      plans: { "claude:plan.md": { memo: "keep plan" } },
      projects: {
        "claude:C--repo": { memo: "stale", nameOverride: "stale", hidden: true },
        "codex:C--repo": { memo: "stale codex" },
        "claude:unmatched": { memo: "legacy fallback" },
      },
      sessions: { "claude:session": { memo: "keep session" } },
    };
    const registry = validateProjectRegistry({
      schemaVersion: 1,
      updatedAt: timestamp,
      migratedFromBoardAt: timestamp,
      projects: {
        [projectId]: {
          id: projectId,
          rootPath: "C:\\work\\repo",
          displayName: "Shared name",
          sources: ["claude", "codex"],
          providerRefs: {
            claude: ["C--repo"],
            codex: ["codex:C--repo"],
          },
          status: "보류",
          memo: "shared memo",
          tracks: [],
          hidden: false,
          order: 3,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    });

    const overlaid = overlayProjectRegistryOnBoard(board, registry);
    expect(overlaid.projects["claude:C--repo"]).toEqual({
      status: "보류",
      memo: "shared memo",
      nameOverride: "Shared name",
      repoPath: "C:\\work\\repo",
      order: 3,
    });
    expect(overlaid.projects["codex:C--repo"]).toEqual(overlaid.projects["claude:C--repo"]);
    expect(overlaid.projects["claude:unmatched"]?.memo).toBe("legacy fallback");
    expect(overlaid.plans).toBe(board.plans);
    expect(overlaid.sessions).toBe(board.sessions);
  });

  it("updates one shared record through provider ids without writing legacy board projects", async () => {
    const filePath = await temporaryRegistryPath();
    const directory = path.dirname(filePath);
    const boardFilePath = path.join(directory, "board.json");
    const boardText = '{"schemaVersion":2,"plans":{},"projects":{"claude:C--repo":{"memo":"legacy"}},"sessions":{}}\n';
    await fs.writeFile(boardFilePath, boardText, "utf8");
    const registry = await migrateBoardProjectsToRegistry(
      { "claude:C--repo": { memo: "legacy" }, "codex:C--repo": {} },
      [
        { rootPath: path.join(directory, "repo"), source: "claude", providerRef: "C--repo" },
        { rootPath: path.join(directory, "repo"), source: "codex", providerRef: "codex:C--repo" },
      ],
      { filePath, boardFilePath, backupDir: path.join(directory, "backups") },
    );
    const projectId = Object.keys(registry.projects)[0];

    const updated = await setRegistryProjectsField(
      ["claude:C--repo", "codex:C--repo"],
      {
        status: "보류",
        memo: "shared edit",
        nameOverride: "Shared name",
        tracks: [{ id: "track", title: "Next", items: [] }],
        hidden: true,
        order: 4,
      },
      { filePath },
    );

    expect(Object.keys(updated.projects)).toEqual([projectId]);
    expect(updated.projects[projectId]).toMatchObject({
      status: "보류",
      memo: "shared edit",
      displayName: "Shared name",
      tracks: [{ id: "track" }],
      hidden: true,
      order: 4,
    });
    expect(await fs.readFile(boardFilePath, "utf8")).toBe(boardText);
  });

  it("maps ordering and visibility batches onto shared records", async () => {
    const filePath = await temporaryRegistryPath();
    const rootPath = path.join(path.dirname(filePath), "repo");
    const registry = await reconcileDiscoveredProjects(
      [
        { rootPath, source: "claude", providerRef: "C--repo" },
        { rootPath, source: "codex", providerRef: "codex:C--repo" },
      ],
      { filePath },
    );
    const projectId = Object.keys(registry.projects)[0];

    await setRegistryProjectsOrder({ "claude:C--repo": 8 }, { filePath });
    const hidden = await setRegistryProjectsVisibility(
      ["codex:C--repo"],
      { hidden: true, status: "보관" },
      { filePath },
    );

    expect(hidden.projects[projectId]).toMatchObject({ order: 8, hidden: true, status: "보관" });
  });
});
