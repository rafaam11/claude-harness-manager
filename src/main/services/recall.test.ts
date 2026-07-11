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

  it("prefers shared registry metadata over stale board project fields", async () => {
    const projectId = "D--repo";
    const sessionId = "session-registry";
    const transcript = [
      JSON.stringify({ type: "user", message: { content: "shared project" }, cwd: "C:/work/repo", sessionId }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "shared answer" }], model: "claude-sonnet-5" },
        cwd: "C:/work/repo",
        sessionId,
      }),
    ].join("\n");
    await writeText(path.join(homeDir, ".claude", "projects", projectId, `${sessionId}.jsonl`), transcript);
    await writeJson(path.join(homeDir, ".harness-manager", "board.json"), {
      schemaVersion: 2,
      projects: { "claude:D--repo": { memo: "stale board memo", status: "보관" } },
      plans: {},
      sessions: {},
    });
    const registryId = "61d98fcb-9c8d-4f8b-9e6f-723555a24a71";
    const timestamp = "2026-07-11T12:00:00.000Z";
    await writeJson(path.join(homeDir, ".harness-manager", "projects.json"), {
      schemaVersion: 1,
      updatedAt: timestamp,
      migratedFromBoardAt: timestamp,
      projects: {
        [registryId]: {
          id: registryId,
          rootPath: "C:/work/repo",
          displayName: "Shared name",
          sources: ["claude"],
          providerRefs: { claude: [projectId], codex: [] },
          status: "보류",
          memo: "shared memo",
          tracks: [],
          hidden: false,
          order: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
    });

    const { getWorkspaceProjects } = await loadRecallModule();
    const projects = await getWorkspaceProjects();

    expect(projects[0].board).toMatchObject({
      status: "보류",
      memo: "shared memo",
      nameOverride: "Shared name",
    });
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

  it("deduplicates Claude agent transcripts under their parent conversation session", async () => {
    const projectId = "D--repo";
    const sessionId = "session-a";
    const mainTranscript = [
      JSON.stringify({ type: "ai-title", aiTitle: "Main conversation" }),
      JSON.stringify({
        type: "user",
        message: { content: "사용자가 직접 입력한 프롬프트" },
        cwd: "C:/work/repo",
        sessionId,
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "main answer" }], model: "claude-sonnet-5" },
        cwd: "C:/work/repo",
        sessionId,
      }),
    ].join("\n");
    const agentTranscript = [
      JSON.stringify({
        type: "user",
        message: { content: "하위 에이전트에게 넘긴 조사 프롬프트" },
        cwd: "C:/work/repo",
        sessionId,
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "agent answer" }], model: "claude-sonnet-5" },
        cwd: "C:/work/repo",
        sessionId,
      }),
    ].join("\n");

    await writeText(path.join(homeDir, ".claude", "projects", projectId, `${sessionId}.jsonl`), mainTranscript);
    await writeText(path.join(homeDir, ".claude", "projects", projectId, "agent-a123.jsonl"), agentTranscript);

    const { getProjectSessions } = await loadRecallModule();
    const sessions = await getProjectSessions("claude:D--repo");

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId,
      sessionKind: "main",
      aiTitle: "Main conversation",
      lastPrompt: "사용자가 직접 입력한 프롬프트",
      lastAssistantSnippet: "main answer",
    });
  });

  it("adds an older pinned direct session to the timeline and exposes it in the pinned lookup", async () => {
    const projectId = "D--repo";
    const pinnedSessionId = "pinned-session";
    const latestSessionId = "latest-session";
    const transcript = (sessionId: string, prompt: string) =>
      [
        JSON.stringify({ type: "user", message: { content: prompt }, cwd: "C:/work/repo", sessionId }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: `${prompt} answer` }], model: "claude-sonnet-5" },
          cwd: "C:/work/repo",
          sessionId,
        }),
      ].join("\n");
    const pinnedPath = path.join(homeDir, ".claude", "projects", projectId, `${pinnedSessionId}.jsonl`);
    const latestPath = path.join(homeDir, ".claude", "projects", projectId, `${latestSessionId}.jsonl`);
    await writeText(pinnedPath, transcript(pinnedSessionId, "pinned work"));
    await writeText(latestPath, transcript(latestSessionId, "latest work"));
    await fs.utimes(pinnedPath, new Date("2026-07-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
    await fs.utimes(latestPath, new Date("2026-07-02T00:00:00.000Z"), new Date("2026-07-02T00:00:00.000Z"));
    await writeJson(path.join(homeDir, ".harness-manager", "board.json"), {
      schemaVersion: 2,
      projects: {},
      plans: {},
      sessions: { [`claude:${pinnedSessionId}`]: { pinned: true } },
    });

    const { getPinnedProjectSessions, getTimeline } = await loadRecallModule();
    const [pinned, timeline] = await Promise.all([
      getPinnedProjectSessions(`claude:${projectId}`),
      getTimeline(),
    ]);

    expect(pinned).toHaveLength(1);
    expect(pinned[0]).toMatchObject({ sessionId: pinnedSessionId, pinned: true, sessionKind: "main" });
    expect(timeline.filter((event) => event.kind === "session")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: `claude:${pinnedSessionId}`, pinned: true }),
        expect.objectContaining({ sessionId: `claude:${latestSessionId}`, pinned: false }),
      ]),
    );
  });
});

// 실행 중 세션이 "일하는 중"인지 "나를 기다리는 중"인지는 transcript 마지막 줄 모양만으로 정해진다.
// 실제 .jsonl에서 관찰한 줄 형태를 그대로 재현해 파싱과 판정을 함께 검증한다.
describe("세션 활동 상태 판별", () => {
  const TS = "2026-07-11T09:32:31.400Z";

  const userPrompt = (text: string) => ({ type: "user", message: { role: "user", content: text }, timestamp: TS });
  const toolResult = () => ({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
    timestamp: TS,
  });
  const assistantTool = (name: string) => ({
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name, input: {} }],
    },
    timestamp: TS,
  });
  const assistantDone = () => ({
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "다 했습니다" }],
    },
    timestamp: TS,
  });
  const turnEnd = () => ({ type: "system", subtype: "turn_duration", durationMs: 1234, timestamp: TS });
  const lastPrompt = () => ({ type: "last-prompt", lastPrompt: "고쳐 줘" });

  async function activityOf(lines: unknown[]) {
    const sessionId = "activity-session";
    const filePath = path.join(homeDir, ".claude", "projects", "D--repo", `${sessionId}.jsonl`);
    await writeText(filePath, lines.map((l) => JSON.stringify(l)).join("\n"));
    const { getSessionRecallByTranscriptPath } = await loadRecallModule();
    const recall = await getSessionRecallByTranscriptPath(filePath);
    return recall?.activity;
  }

  it("도구를 호출한 직후면 작업 중으로 보고 도구 이름을 함께 준다", async () => {
    expect(await activityOf([userPrompt("고쳐 줘"), assistantTool("Edit")])).toEqual({
      state: "working",
      since: TS,
      tool: "Edit",
    });
  });

  it("tool_result가 마지막이면(모델이 응답할 차례) 작업 중으로 본다", async () => {
    expect(await activityOf([assistantTool("Bash"), toolResult()])).toMatchObject({ state: "working", tool: null });
  });

  it("end_turn과 turn_duration은 사용자 입력 대기(대기 중)로 본다", async () => {
    expect(await activityOf([userPrompt("고쳐 줘"), assistantDone()])).toMatchObject({ state: "idle" });
    // 실제 파일은 end_turn 뒤에 system/turn_duration과 합성 last-prompt 줄이 더 붙는다.
    expect(await activityOf([assistantDone(), turnEnd(), lastPrompt()])).toMatchObject({ state: "idle", since: TS });
  });

  it("ExitPlanMode·AskUserQuestion이 마지막이면 사용자 액션을 기다리는 상태로 구분한다", async () => {
    expect(await activityOf([assistantTool("ExitPlanMode")])).toMatchObject({
      state: "awaiting-approval",
      tool: "ExitPlanMode",
    });
    expect(await activityOf([assistantTool("AskUserQuestion")])).toMatchObject({ state: "awaiting-input" });
  });

  it("계획이 승인되면(tool_result가 붙으면) 다시 작업 중으로 돌아온다", async () => {
    expect(await activityOf([assistantTool("ExitPlanMode"), toolResult()])).toMatchObject({ state: "working" });
  });

  it("서브에이전트(sidechain) 줄은 메인 대화의 상태를 바꾸지 않는다", async () => {
    const sidechainWork = { ...assistantTool("Grep"), isSidechain: true };
    expect(await activityOf([assistantDone(), turnEnd(), sidechainWork])).toMatchObject({ state: "idle" });
  });

  it("판단할 줄이 없으면 unknown", async () => {
    expect(await activityOf([lastPrompt()])).toEqual({ state: "unknown", since: null, tool: null });
  });

  it("tail이 사용자 프롬프트까지 못 닿아도 합성 last-prompt 줄에서 마지막 입력을 건진다", async () => {
    const sessionId = "tail-cut-session";
    const filePath = path.join(homeDir, ".claude", "projects", "D--repo", `${sessionId}.jsonl`);
    // 사용자 줄 없이 도구 왕복만 남은 tail(도구 출력이 커서 앞부분이 잘린 상황)
    await writeText(
      filePath,
      [assistantTool("Bash"), toolResult(), assistantDone(), turnEnd(), lastPrompt()]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );

    const { getSessionRecallByTranscriptPath } = await loadRecallModule();
    const recall = await getSessionRecallByTranscriptPath(filePath);

    expect(recall?.lastPrompt).toBe("고쳐 줘");
  });
});
