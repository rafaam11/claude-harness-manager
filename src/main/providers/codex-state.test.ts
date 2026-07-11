import { describe, expect, it } from "vitest";
import { parseCodexStateThreads } from "./codex-state.js";

describe("Codex state thread fallback", () => {
  it("keeps only active thread metadata needed when a rollout file is locked", () => {
    const threads = parseCodexStateThreads(
      JSON.stringify([
        {
          id: "019f4973-d3f4-7083-9852-1b72e1ab288d",
          rollout_path: "C:\\Users\\me\\.codex\\sessions\\rollout.jsonl",
          created_at: 1783643755,
          updated_at: 1783650334,
          source: "cli",
          model_provider: "openai",
          cwd: "C:\\repo",
          title: "현재 세션",
          model: "gpt-5.6-sol",
          thread_source: "user",
          has_user_event: 1,
        },
        { id: "broken", cwd: 42 },
      ]),
    );

    expect(threads).toEqual([
      {
        id: "019f4973-d3f4-7083-9852-1b72e1ab288d",
        rolloutPath: "C:\\Users\\me\\.codex\\sessions\\rollout.jsonl",
        createdAt: 1783643755,
        updatedAt: 1783650334,
        source: "cli",
        modelProvider: "openai",
        cwd: "C:\\repo",
        title: "현재 세션",
        model: "gpt-5.6-sol",
        threadSource: "user",
      },
    ]);
  });
});
