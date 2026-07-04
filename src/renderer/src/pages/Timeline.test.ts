import { describe, expect, it } from "vitest";
import { isTopLevelTimelineEvent } from "./Timeline";
import type { TimelineEvent } from "./workspace-shared";

const base = {
  ts: 1,
  projectId: "claude:repo",
  realPath: "C:\\repo",
  title: "event",
  status: "진행중",
} satisfies Omit<TimelineEvent, "kind">;

describe("timeline top-level filtering", () => {
  it("hides standalone plan events so the timeline stays session-centered", () => {
    const visible = new Set<string>(["claude:session-1"]);

    expect(isTopLevelTimelineEvent({ ...base, kind: "plan", filename: "plan.md" }, visible)).toBe(false);
    expect(
      isTopLevelTimelineEvent(
        { ...base, kind: "plan", filename: "child.md", parentSessionId: "claude:session-1" },
        visible,
      ),
    ).toBe(false);
    expect(
      isTopLevelTimelineEvent(
        { ...base, kind: "plan", filename: "orphan-child.md", parentSessionId: "claude:missing" },
        visible,
      ),
    ).toBe(true);
    expect(isTopLevelTimelineEvent({ ...base, kind: "session", sessionId: "claude:session-1" }, visible)).toBe(true);
  });
});
