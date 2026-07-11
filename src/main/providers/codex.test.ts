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

  it("keeps only the actual Codex user prompt when a message includes injected context", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "07",
      "04",
      "rollout-2026-07-04T10-00-00-019f2aaa-1111-7222-8333-444455556666.jsonl",
    );
    await writeText(
      sessionPath,
      [
        JSON.stringify({
          timestamp: "2026-07-04T01:00:00.000Z",
          type: "session_meta",
          payload: {
            session_id: "019f2aaa-1111-7222-8333-444455556666",
            cwd: "C:\\repo",
            model: "gpt-5.5",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-04T01:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: "# AGENTS.md instructions for C:\\repo\n<INSTRUCTIONS>...</INSTRUCTIONS>" },
              { type: "input_text", text: "<environment_context>\n...</environment_context>" },
              { type: "input_text", text: "타임라인을 고쳐줘" },
            ],
          },
        }),
      ].join("\n"),
    );
    await fs.utimes(sessionPath, new Date("2026-07-04T01:01:00.000Z"), new Date("2026-07-04T01:01:00.000Z"));

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions[0]).toMatchObject({
      title: "타임라인을 고쳐줘",
      lastUserText: "타임라인을 고쳐줘",
    });
  });

  it("aggregates duplicate rollout files into one user-facing session using history", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionId = "019f2a84-a3f8-73e3-a3ea-3cca10a8fcbd";
    await writeText(
      path.join(codexHome, "history.jsonl"),
      [
        JSON.stringify({ session_id: sessionId, ts: 1783169907, text: "이전 요청" }),
        JSON.stringify({ session_id: sessionId, ts: 1783171120, text: "최신 요청" }),
      ].join("\n"),
    );
    for (const [index, prompt] of ["첫 rollout", "둘째 rollout"].entries()) {
      const sessionPath = path.join(
        codexHome,
        "sessions",
        "2026",
        "07",
        "04",
        `rollout-2026-07-04T10-00-0${index}-${sessionId}.jsonl`,
      );
      await writeText(
        sessionPath,
        [
          JSON.stringify({
            timestamp: `2026-07-04T01:0${index}:00.000Z`,
            type: "session_meta",
            payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
          }),
          JSON.stringify({
            timestamp: `2026-07-04T01:0${index}:01.000Z`,
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: prompt }],
            },
          }),
        ].join("\n"),
      );
    }

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: `codex:${sessionId}`,
      title: "최신 요청",
      lastUserText: "최신 요청",
    });
  });

  it("uses history as a title overlay without hiding real rollout sessions", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const indexedSessionId = "019f2aaa-indexed-7222-8333-444455556666";
    const rolloutOnlySessionId = "019f2bbb-rollout-7222-8333-444455556666";
    await writeText(
      path.join(codexHome, "history.jsonl"),
      JSON.stringify({ session_id: indexedSessionId, ts: 1783171120, text: "history title" }),
    );

    for (const [sessionId, prompt] of [
      [indexedSessionId, "indexed prompt"],
      [rolloutOnlySessionId, "rollout only prompt"],
    ] as const) {
      await writeText(
        path.join(codexHome, "sessions", "2026", "07", "04", `rollout-2026-07-04T10-00-00-${sessionId}.jsonl`),
        [
          JSON.stringify({
            timestamp: "2026-07-04T01:00:00.000Z",
            type: "session_meta",
            payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
          }),
          JSON.stringify({
            timestamp: "2026-07-04T01:01:00.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: prompt }],
            },
          }),
        ].join("\n"),
      );
    }

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions.map((s) => s.id).sort()).toEqual([
      `codex:${indexedSessionId}`,
      `codex:${rolloutOnlySessionId}`,
    ]);
    expect(sessions.find((s) => s.id === `codex:${indexedSessionId}`)?.title).toBe("history title");
    expect(sessions.find((s) => s.id === `codex:${rolloutOnlySessionId}`)?.title).toBe("rollout only prompt");
  });

  it("classifies direct user sessions separately from delegated worker sessions", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const mainSessionId = "019f2main-1111-7222-8333-444455556666";
    const workerSessionId = "019f2work-1111-7222-8333-444455556666";
    for (const [sessionId, prompt] of [
      [mainSessionId, "현재 앱의 버그를 고쳐줘"],
      [
        workerSessionId,
        "CODE REVIEW TASK (READ-ONLY; DO NOT MUTATE REPO)\n\nRepository: C:\\repo\nScope: Re-review final blocker fix",
      ],
    ] as const) {
      await writeText(
        path.join(codexHome, "sessions", "2026", "07", "05", `rollout-2026-07-05T10-00-00-${sessionId}.jsonl`),
        [
          JSON.stringify({
            timestamp: "2026-07-05T01:00:00.000Z",
            type: "session_meta",
            payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
          }),
          JSON.stringify({
            timestamp: "2026-07-05T01:01:00.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: prompt }],
            },
          }),
        ].join("\n"),
      );
    }

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions.find((s) => s.id === `codex:${mainSessionId}`)?.sessionKind).toBe("main");
    expect(sessions.find((s) => s.id === `codex:${workerSessionId}`)?.sessionKind).toBe("worker");
  });

  it("uses Codex thread_source metadata to classify subagent rollouts as workers", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionId = "019f2subg-1111-7222-8333-444455556666";
    await writeText(
      path.join(codexHome, "sessions", "2026", "07", "05", `rollout-2026-07-05T10-30-00-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-07-05T01:30:00.000Z",
          type: "session_meta",
          payload: {
            session_id: sessionId,
            cwd: "C:\\repo",
            model: "gpt-5.5",
            thread_source: "subagent",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-05T01:31:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Inspect src/main/providers/codex.ts and report findings." }],
          },
        }),
      ].join("\n"),
    );

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions[0]).toMatchObject({
      id: `codex:${sessionId}`,
      sessionKind: "worker",
    });
  });

  it("keeps metadata-only Codex session files when they have a cwd", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionId = "019f2meta-1111-7222-8333-444455556666";
    await writeText(
      path.join(codexHome, "sessions", "2026", "07", "05", `rollout-2026-07-05T11-00-00-${sessionId}.jsonl`),
      JSON.stringify({
        timestamp: "2026-07-05T02:00:00.000Z",
        type: "session_meta",
        payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
      }),
    );

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions).toEqual([
      expect.objectContaining({
        id: `codex:${sessionId}`,
        projectId: "codex:C--repo",
        sessionKind: "unknown",
        title: expect.stringContaining(sessionId),
      }),
    ]);
  });

  it("does not let later worker fragments replace the main user-facing session", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionId = "019f2merge-1111-7222-8333-444455556666";
    await writeText(
      path.join(codexHome, "sessions", "2026", "07", "05", `rollout-2026-07-05T10-00-00-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-07-05T01:00:00.000Z",
          type: "session_meta",
          payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
        }),
        JSON.stringify({
          timestamp: "2026-07-05T01:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "타임라인 버그를 고쳐줘" }],
          },
        }),
      ].join("\n"),
    );
    await writeText(
      path.join(codexHome, "sessions", "2026", "07", "05", `rollout-2026-07-05T10-05-00-019f2worker-1111-7222-8333-444455556666.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-07-05T01:05:00.000Z",
          type: "session_meta",
          payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
        }),
        JSON.stringify({
          timestamp: "2026-07-05T01:06:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "You are implementing Task 12 of the Harness Manager refactor." }],
          },
        }),
      ].join("\n"),
    );

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: `codex:${sessionId}`,
      sessionKind: "main",
      title: "타임라인 버그를 고쳐줘",
      lastUserText: "타임라인 버그를 고쳐줘",
    });
  });

  it("ignores shell command wrappers when choosing the session title", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionId = "019f2shell-1111-7222-8333-444455556666";
    await writeText(
      path.join(codexHome, "sessions", "2026", "07", "05", `rollout-2026-07-05T12-00-00-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-07-05T03:00:00.000Z",
          type: "session_meta",
          payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
        }),
        JSON.stringify({
          timestamp: "2026-07-05T03:01:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "세션 탭을 고쳐줘" }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-05T03:02:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "<user_shell_command>\n<command>\nnpm run dev\n</command>\n</user_shell_command>" }],
          },
        }),
      ].join("\n"),
    );

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions[0]).toMatchObject({
      title: "세션 탭을 고쳐줘",
      lastUserText: "세션 탭을 고쳐줘",
      sessionKind: "main",
    });
  });

  it("classifies imported Codex Desktop rollout logs as auxiliary system sessions", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionId = "019f2old-1111-7222-8333-444455556666";
    await writeText(
      path.join(codexHome, "sessions", "2026", "07", "04", `rollout-2026-07-04T08-53-33-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-07-03T23:53:33.000Z",
          type: "session_meta",
          payload: {
            session_id: sessionId,
            cwd: "C:\\repo",
            originator: "Codex Desktop",
            source: "vscode",
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          timestamp: "2026-07-03T23:53:34.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "PR이 몇개 있는데 뭐지?" }],
          },
        }),
      ].join("\n"),
    );

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions[0]).toMatchObject({
      id: `codex:${sessionId}`,
      title: "PR이 몇개 있는데 뭐지?",
      lastUserText: "PR이 몇개 있는데 뭐지?",
      sessionKind: "system",
    });
  });

  it("keeps warning-only Codex records out of the default session list", async () => {
    const codexHome = path.join(homeDir, ".codex");
    const sessionId = "019f2warn-1111-7222-8333-444455556666";
    await writeText(
      path.join(codexHome, "sessions", "2026", "07", "05", `rollout-2026-07-05T12-30-00-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-07-05T03:30:00.000Z",
          type: "session_meta",
          payload: { session_id: sessionId, cwd: "C:\\repo", model: "gpt-5.5" },
        }),
        JSON.stringify({
          timestamp: "2026-07-05T03:31:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "⚠ Skipped loading 1 skill(s) due to invalid SKILL.md files." }],
          },
        }),
      ].join("\n"),
    );

    const { codexProvider } = await loadCodexProvider();
    const sessions = await codexProvider.listSessions();

    expect(sessions[0]).toMatchObject({
      id: `codex:${sessionId}`,
      lastUserText: undefined,
      sessionKind: "system",
    });
  });
});
