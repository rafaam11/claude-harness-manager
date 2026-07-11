import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NormalizedSession } from "@shared/provider-types";

const { getProvidersMock, readCodexStateThreadsMock } = vi.hoisted(() => ({
  getProvidersMock: vi.fn(),
  readCodexStateThreadsMock: vi.fn<() => Promise<[]>>(async () => []),
}));

vi.mock("../providers/registry.js", () => ({
  getProviders: getProvidersMock,
  prefixEntityId: (provider: string, id: string) => `${provider}:${id}`,
}));

vi.mock("../providers/codex-state.js", () => ({
  readCodexStateThreads: readCodexStateThreadsMock,
}));

import { getLiveSessions } from "./live-sessions.js";

const onWindows = process.platform === "win32";
let holder: ChildProcess | null = null;
let tempDir: string | null = null;

async function createExclusivelyLockedRollout(): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "harness-live-codex-"));
  const rolloutPath = path.join(tempDir, "rollout-active.jsonl");
  await fs.writeFile(rolloutPath, "{}\n", "utf8");

  holder = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$stream=[IO.File]::Open($env:HARNESS_TEST_ROLLOUT,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None);Write-Output ready;Start-Sleep -Seconds 30;$stream.Dispose()",
    ],
    { windowsHide: true, env: { ...process.env, HARNESS_TEST_ROLLOUT: rolloutPath } },
  );
  await once(holder.stdout!, "data");
  return rolloutPath;
}

afterEach(async () => {
  if (holder && holder.exitCode === null) {
    const exited = once(holder, "exit");
    holder.kill();
    await exited;
  }
  holder = null;
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
  getProvidersMock.mockReset();
  readCodexStateThreadsMock.mockResolvedValue([]);
});

describe.runIf(onWindows)("Codex live-session transcript fallback", () => {
  it("shows a locked main rollout when state SQLite returns no threads", async () => {
    const rolloutPath = await createExclusivelyLockedRollout();
    const main: NormalizedSession = {
      id: "codex:main",
      provider: "codex",
      projectId: "codex:C--repo",
      sessionKind: "main",
      title: "현재 Codex 작업",
      cwd: "C:\\repo",
      model: "gpt-5.5",
      updatedAt: "2026-07-11T12:00:00.000Z",
      sourcePath: rolloutPath,
      lastUserText: "Codex 실행 세션을 보여줘",
      lastAssistantText: "처리 중입니다.",
    };
    getProvidersMock.mockReturnValue([
      {
        listSessions: vi.fn(async () => [
          main,
          { ...main, id: "codex:worker", sessionKind: "worker" as const },
          { ...main, id: "codex:imported", sessionKind: "imported" as const },
          { ...main, id: "codex:no-rollout", sourcePath: undefined },
        ]),
      },
    ]);

    await expect(getLiveSessions("codex")).resolves.toEqual([
      expect.objectContaining({
        id: "codex:main",
        projectId: "codex:C--repo",
        title: "현재 Codex 작업",
        source: "codex-rollout-lock",
        lastPrompt: "Codex 실행 세션을 보여줘",
        lastAssistantSnippet: "처리 중입니다.",
      }),
    ]);
  });
});
