import { describe, expect, it } from "vitest";
import {
  canHideTimelineProjectTab,
  filterTimelineEventsForVisibleProjects,
  isTopLevelTimelineEvent,
  timelineModelBadge,
} from "./Timeline";
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

  it("excludes hidden projects from timeline tabs and event rows by default", () => {
    const events: TimelineEvent[] = [
      { ...base, kind: "session", sessionId: "claude:shown", projectId: "claude:shown" },
      { ...base, kind: "session", sessionId: "claude:hidden", projectId: "claude:hidden" },
      { ...base, kind: "session", sessionId: "codex:hidden", projectId: "codex:hidden" },
    ];
    const hiddenProjectIds = new Set(["claude:hidden", "codex:hidden"]);

    expect(filterTimelineEventsForVisibleProjects(events, hiddenProjectIds, "all").map((e) => e.sessionId)).toEqual([
      "claude:shown",
    ]);
    expect(
      filterTimelineEventsForVisibleProjects(events, hiddenProjectIds, "claude:hidden").map((e) => e.sessionId),
    ).toEqual([]);
  });

  it("shows a provider fallback badge when a session has no model metadata", () => {
    expect(
      timelineModelBadge({ ...base, kind: "session", sessionId: "codex:s", provider: "codex", lastModel: null }),
    ).toEqual({
      label: "Codex",
      className: "bdg-model-missing bdg-model-missing-codex",
      title: "모델 정보 없음",
    });
    expect(
      timelineModelBadge({
        ...base,
        kind: "session",
        sessionId: "claude:s",
        provider: "claude",
        lastModel: "claude-sonnet-5",
      }),
    ).toEqual({
      label: "Sonnet 5",
      className: "bdg-model-sonnet",
      title: "claude-sonnet-5",
    });
  });

  it("allows right-click hide actions only for real project tabs", () => {
    expect(canHideTimelineProjectTab("claude:C--repo")).toBe(true);
    expect(canHideTimelineProjectTab("codex:C--repo")).toBe(true);
    expect(canHideTimelineProjectTab("all")).toBe(false);
    expect(canHideTimelineProjectTab("__none__")).toBe(false);
  });
});
