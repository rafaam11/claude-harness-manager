import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_LIVE_SESSION_HOOK_SOURCE,
  mergeClaudeLiveTrackingHooks,
  removeClaudeLiveTrackingHooks,
} from "./claude-live-tracking.js";

const COMMAND = 'node "C:\\Users\\me\\.harness-manager\\hooks\\claude-live-session.mjs"';

describe("Claude live tracking hook settings", () => {
  it("adds SessionStart and SessionEnd hooks without replacing existing hooks or duplicating itself", () => {
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
    });
    const hooks = twice.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    const commands = ["SessionStart", "SessionEnd"].flatMap((event) =>
      (hooks[event] ?? []).flatMap((group) => group.hooks?.map((hook) => hook.command) ?? []),
    );
    expect(commands.filter((command) => command === COMMAND)).toHaveLength(2);
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
