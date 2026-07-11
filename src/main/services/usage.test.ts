import { describe, expect, it } from "vitest";
import {
  buildClaudeCaptureSettings,
  buildClaudeUsageSummary,
  buildCodexUsageSummary,
  parseClaudeUsageLine,
  parseCodexUsageLine,
  parseUsageSnapshot,
  readUsageEvents,
  resolveForwardShell,
  restoreClaudeCaptureSettings,
} from "./usage.js";

const NOW = Date.parse("2026-07-05T08:00:00.000Z");

describe("usage aggregation", () => {
  it("keeps readable usage events when another log file cannot be opened", async () => {
    const line = JSON.stringify({
      timestamp: "2026-07-05T07:45:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
      },
    });
    const result = await readUsageEvents(
      ["ok.jsonl", "locked.jsonl"],
      parseCodexUsageLine,
      async (file) => {
        if (file === "locked.jsonl") throw new Error("file is locked");
        return {
          mtimeMs: NOW,
          lines: (async function* () {
            yield line;
          })(),
        };
      },
    );

    expect(result.events).toHaveLength(1);
    expect(result.errors).toEqual([expect.stringContaining("locked.jsonl")]);
  });

  it("maps Codex primary and secondary rate limits to 5h and weekly windows", () => {
    const event = parseCodexUsageLine(
      JSON.stringify({
        timestamp: "2026-07-05T07:45:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 250,
              output_tokens: 80,
              reasoning_output_tokens: 12,
              total_tokens: 1080,
            },
          },
        },
        rate_limits: {
          primary: { used_percent: 31, window_minutes: 300, resets_at: 1783242000 },
          secondary: { used_percent: 44, window_minutes: 10080, resets_at: 1783725600 },
          plan_type: "pro",
        },
      }),
    );

    const summary = buildCodexUsageSummary([event!], NOW);

    expect(summary.provider).toBe("codex");
    expect(summary.quota.fiveHour).toMatchObject({
      usedPercent: 31,
      windowMinutes: 300,
      resetAt: "2026-07-05T09:00:00.000Z",
    });
    expect(summary.quota.weekly).toMatchObject({
      usedPercent: 44,
      windowMinutes: 10080,
      resetAt: "2026-07-10T23:20:00.000Z",
    });
    expect(summary.quota.planType).toBe("pro");
    expect(summary.tokens.fiveHour.totalTokens).toBe(1080);
    expect(summary.tokens.fiveHour.cachedInputTokens).toBe(250);
  });

  it("deduplicates repeated Claude assistant records by message id before summing tokens", () => {
    const line = JSON.stringify({
      timestamp: "2026-07-05T07:30:00.000Z",
      type: "assistant",
      message: {
        id: "msg_1",
        model: "claude-sonnet-5",
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 40,
        },
      },
    });

    const first = parseClaudeUsageLine(line, "a.jsonl", NOW)!;
    const duplicate = parseClaudeUsageLine(line, "a.jsonl", NOW)!;
    const summary = buildClaudeUsageSummary([first, duplicate], null, NOW);

    expect(summary.provider).toBe("claude");
    expect(summary.tokens.fiveHour).toMatchObject({
      inputTokens: 100,
      cacheCreationInputTokens: 20,
      cacheReadInputTokens: 30,
      outputTokens: 40,
      totalTokens: 190,
      eventCount: 1,
    });
  });

  it("parses Claude usage snapshots and marks stale quota observations", () => {
    const snapshot = parseUsageSnapshot(
      JSON.stringify({
        updated_at: "2026-07-05T07:40:00.000Z",
        five_hour: { used_percentage: 55, resets_at: "2026-07-05T09:00:00.000Z" },
        seven_day: { used_percentage: 72, resets_at: "2026-07-10T09:00:00.000Z" },
      }),
      NOW,
      10 * 60 * 1000,
    );

    expect(snapshot).toMatchObject({
      observedAt: "2026-07-05T07:40:00.000Z",
      stale: true,
      fiveHour: { usedPercent: 55, resetAt: "2026-07-05T09:00:00.000Z" },
      weekly: { usedPercent: 72, resetAt: "2026-07-10T09:00:00.000Z" },
    });
  });
});

describe("Claude capture settings", () => {
  it("wraps an existing statusLine command and can restore it", () => {
    const current = {
      statusLine: { type: "command", command: "node C:/Users/me/.claude/statusline/custom-status.mjs" },
    };
    const proxyCommand = 'node "C:\\Users\\me\\.harness-manager\\usage\\claude-usage-proxy.mjs"';

    const setup = buildClaudeCaptureSettings(current, proxyCommand);

    expect(setup.changed).toBe(true);
    expect(setup.originalCommand).toBe("node C:/Users/me/.claude/statusline/custom-status.mjs");
    expect(setup.next.statusLine).toEqual({ type: "command", command: proxyCommand });

    const restored = restoreClaudeCaptureSettings(setup.next, proxyCommand, setup.originalCommand);
    expect(restored.changed).toBe(true);
    expect(restored.next.statusLine).toEqual({
      type: "command",
      command: "node C:/Users/me/.claude/statusline/custom-status.mjs",
    });
  });
});

describe("resolveForwardShell", () => {
  const BASH = "C:\\Program Files\\Git\\bin\\bash.exe";

  it("returns git-bash for a bash-style statusLine on win32 (claude-hud case)", () => {
    const cmd =
      'cols=$(stty size </dev/tty 2>/dev/null | awk \'{print $2}\'); export COLUMNS=$(( ${cols:-120} )); exec "/c/Program Files/nodejs/node" "$plugin_dir/dist/index.js"';
    expect(resolveForwardShell(cmd, "win32", () => BASH)).toBe(BASH);
  });

  it("keeps cmd.exe (null) for a plain windows command", () => {
    expect(resolveForwardShell("node C:\\Users\\me\\hud.mjs", "win32", () => BASH)).toBeNull();
  });

  it("returns null on posix so shell:true uses /bin/sh", () => {
    expect(resolveForwardShell("foo=$(bar); exec baz", "linux", () => BASH)).toBeNull();
  });

  it("falls back to null (cmd.exe) when git-bash is not found", () => {
    expect(resolveForwardShell("foo=$(bar); exec baz", "win32", () => null)).toBeNull();
  });

  it("returns null for an empty command", () => {
    expect(resolveForwardShell(null, "win32", () => BASH)).toBeNull();
  });
});
