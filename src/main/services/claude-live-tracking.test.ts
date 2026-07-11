import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLAUDE_LIVE_SESSION_HOOK_SOURCE,
  claudeLiveTrackingState,
  mergeClaudeLiveTrackingHooks,
  removeClaudeLiveTrackingHooks,
} from "./claude-live-tracking.js";

const COMMAND = 'node "C:\\Users\\me\\.harness-manager\\hooks\\claude-live-session.mjs"';

describe("Claude live tracking hook settings", () => {
  it("adds SessionStart, SessionEnd and UserPromptSubmit hooks without replacing existing hooks or duplicating itself", () => {
    const settings = {
      hooks: {
        PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "node existing.mjs" }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "node greeting.mjs" }] }],
      },
    };

    const once = mergeClaudeLiveTrackingHooks(settings, COMMAND);
    const twice = mergeClaudeLiveTrackingHooks(once, COMMAND);

    expect(twice.hooks).toMatchObject({
      PostToolUse: settings.hooks.PostToolUse,
      SessionStart: expect.arrayContaining([
        expect.objectContaining({ hooks: expect.arrayContaining([expect.objectContaining({ command: "node greeting.mjs" })]) }),
        expect.objectContaining({ hooks: [expect.objectContaining({ command: COMMAND })] }),
      ]),
      SessionEnd: [expect.objectContaining({ hooks: [expect.objectContaining({ command: COMMAND })] })],
      UserPromptSubmit: [expect.objectContaining({ hooks: [expect.objectContaining({ command: COMMAND })] })],
    });
    const hooks = twice.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    const commands = ["SessionStart", "SessionEnd", "UserPromptSubmit"].flatMap((event) =>
      (hooks[event] ?? []).flatMap((group) => group.hooks?.map((hook) => hook.command) ?? []),
    );
    expect(commands.filter((command) => command === COMMAND)).toHaveLength(3);
  });

  it("reports a SessionStart/SessionEnd-only install as outdated so the app can offer an upgrade", () => {
    const legacy = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: COMMAND }] }],
        SessionEnd: [{ hooks: [{ type: "command", command: COMMAND }] }],
      },
    };

    expect(claudeLiveTrackingState(legacy, COMMAND)).toEqual({ installed: true, outdated: true });
    expect(claudeLiveTrackingState(mergeClaudeLiveTrackingHooks(legacy, COMMAND), COMMAND)).toEqual({
      installed: true,
      outdated: false,
    });
    expect(claudeLiveTrackingState({}, COMMAND)).toEqual({ installed: false, outdated: false });
  });

  it("removes only its own hooks and retains other event entries", () => {
    const merged = mergeClaudeLiveTrackingHooks(
      {
        hooks: {
          SessionEnd: [{ hooks: [{ type: "command", command: "node keep.mjs" }] }],
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node before.mjs" }] }],
        },
      },
      COMMAND,
    );

    const removed = removeClaudeLiveTrackingHooks(merged, COMMAND);

    expect(removed.hooks).toEqual({
      SessionEnd: [{ hooks: [{ type: "command", command: "node keep.mjs" }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node before.mjs" }] }],
    });
  });

  it("emits a Node-parsable ESM hook script", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "chm-claude-live-hook-"));
    const hookPath = path.join(dir, "claude-live-session.mjs");
    try {
      await fs.writeFile(hookPath, CLAUDE_LIVE_SESSION_HOOK_SOURCE, "utf8");
      expect(() => execFileSync(process.execPath, ["--check", hookPath], { stdio: "pipe" })).not.toThrow();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

/** 조상 체인 원소. hook이 PowerShell/`/proc`으로 수집해 pickClaudeAncestor에 넘기는 형태. */
interface Ancestor {
  pid: number;
  parentPid: number;
  name: string;
  command: string;
  startToken: string;
}

// hook은 Claude Code가 `node <파일>`로 돌리는 독립 스크립트다. vite가 아니라 Node로 실제 로드해
// 검증해야 실제 실행과 같은 결과가 나온다(vitest는 프로젝트 밖 파일 import를 가로챈다).
const DRIVER_SOURCE = `import { pickClaudeAncestor } from "./claude-live-session.mjs";
const decode = (arg) => JSON.parse(Buffer.from(arg, "base64").toString("utf8"));
process.stdout.write(JSON.stringify(pickClaudeAncestor(decode(process.argv[2]), decode(process.argv[3]))));
`;

describe("hook의 Claude 조상 프로세스 선택", () => {
  let dir = "";
  let hookPath = "";
  let driverPath = "";

  const pickClaudeAncestor = (chain: Ancestor[], selfPath: string): { pid: number; startToken: string } | null => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
    const out = execFileSync(process.execPath, [driverPath, encode(chain), encode(selfPath)], {
      encoding: "utf8",
    });
    return JSON.parse(out) as { pid: number; startToken: string } | null;
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "chm-claude-live-pick-"));
    hookPath = path.join(dir, "claude-live-session.mjs");
    driverPath = path.join(dir, "driver.mjs");
    await fs.writeFile(hookPath, CLAUDE_LIVE_SESSION_HOOK_SOURCE, "utf8");
    await fs.writeFile(driverPath, DRIVER_SOURCE, "utf8");
  });

  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  const shell = (command: string, pid = 22716): Ancestor => ({
    pid,
    parentPid: 2832,
    name: "cmd.exe",
    command,
    startToken: "20260711195900.000000+540",
  });
  const claudeExe = (pid = 2832): Ancestor => ({
    pid,
    parentPid: 18640,
    name: "claude.exe",
    command: '"C:\\Users\\me\\.local\\bin\\claude.exe" --dangerously-skip-permissions',
    startToken: "20260711195810.000000+540",
  });

  // 이 버그의 본질: hook을 실행한 셸의 커맨드라인에 hook 경로("claude"가 들어간)가 있어서
  // 부분 문자열 매칭이 셸을 Claude로 오인했다. 셸의 PID는 hook 종료와 함께 사라지므로 RUNNING이 영원히 안 떴다.
  it("자기 자신을 실행한 셸을 Claude로 오인하지 않는다", () => {
    const chain = [shell(`C:\\Windows\\system32\\cmd.exe /c node "${hookPath}"`), claudeExe()];
    expect(pickClaudeAncestor(chain, hookPath)).toEqual({
      pid: 2832,
      startToken: "20260711195810.000000+540",
    });
  });

  it("경로 구분자가 달라도(Git Bash) 셸을 건너뛴다", () => {
    const posix = hookPath.replace(/\\/g, "/");
    const chain = [shell(`C:\\Program Files\\Git\\bin\\bash.exe -c node ${posix}`), claudeExe()];
    expect(pickClaudeAncestor(chain, hookPath)?.pid).toBe(2832);
  });

  it("실행 파일명 claude.exe를 매칭한다", () => {
    expect(pickClaudeAncestor([claudeExe(777)], hookPath)?.pid).toBe(777);
  });

  it("npm 전역 설치(node가 cli.js 구동)도 매칭한다", () => {
    const chain: Ancestor[] = [
      shell(`cmd.exe /c node "${hookPath}"`),
      {
        pid: 555,
        parentPid: 1,
        name: "node.exe",
        command:
          'node.exe "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"',
        startToken: "20260711195700.000000+540",
      },
    ];
    expect(pickClaudeAncestor(chain, hookPath)?.pid).toBe(555);
  });

  it("Claude가 아닌 조상만 있으면 null을 낸다", () => {
    const chain: Ancestor[] = [
      shell(`cmd.exe /c node "${hookPath}"`),
      {
        pid: 4580,
        parentPid: 14232,
        name: "WindowsTerminal.exe",
        command: '"C:\\Program Files\\WindowsTerminal.exe"',
        startToken: "20260711182703.000000+540",
      },
    ];
    expect(pickClaudeAncestor(chain, hookPath)).toBeNull();
  });

  // `.claude` 디렉토리나 임시 경로의 "claude" 문자열에 걸려들면 안 된다.
  it("경로에 claude 문자열이 있을 뿐인 프로세스를 매칭하지 않는다", () => {
    const chain: Ancestor[] = [
      {
        pid: 99,
        parentPid: 1,
        name: "powershell.exe",
        command: "powershell.exe -File C:\\Users\\me\\AppData\\Local\\Temp\\claude\\claude-pwd-ps.ps1",
        startToken: "20260711200000.000000+540",
      },
      {
        pid: 100,
        parentPid: 1,
        name: "node.exe",
        command: 'node.exe "C:\\Users\\me\\.claude\\hooks\\stamp-plan-session.mjs"',
        startToken: "20260711200000.000000+540",
      },
    ];
    expect(pickClaudeAncestor(chain, hookPath)).toBeNull();
  });
});
