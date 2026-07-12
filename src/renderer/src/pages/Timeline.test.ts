import { describe, expect, it } from "vitest";
import {
  NONE_KEY,
  activityDetailText,
  canHideTimelineProjectTab,
  elapsedLabel,
  filterTimelineEventsForVisibleProjects,
  groupLiveSessionsByProject,
  groupTimelineByDayAndProject,
  isPinnableTimelineSession,
  isTopLevelTimelineEvent,
  timelineModelBadge,
} from "./Timeline";
import type { LiveSession } from "@shared/provider-types";
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

  it.each([
    ["gpt-5.4-mini", "bdg-model-gpt-mini"],
    ["gpt-5.5", "bdg-model-gpt-55"],
    ["gpt-5.6-sol", "bdg-model-gpt-sol"],
    ["gpt-5.6-terra", "bdg-model-gpt-terra"],
  ])("assigns %s a distinct Codex model badge", (lastModel, className) => {
    expect(
      timelineModelBadge({ ...base, kind: "session", sessionId: "codex:s", provider: "codex", lastModel }),
    ).toMatchObject({ className, title: lastModel });
  });

  it("allows right-click hide actions only for real project tabs", () => {
    expect(canHideTimelineProjectTab("claude:C--repo")).toBe(true);
    expect(canHideTimelineProjectTab("codex:C--repo")).toBe(true);
    expect(canHideTimelineProjectTab("all")).toBe(false);
    expect(canHideTimelineProjectTab("__none__")).toBe(false);
  });

  it("allows pins only for direct timeline sessions", () => {
    expect(
      isPinnableTimelineSession({ ...base, kind: "session", sessionId: "codex:main", provider: "codex", sessionKind: "main" }),
    ).toBe(true);
    expect(
      isPinnableTimelineSession({ ...base, kind: "session", sessionId: "codex:worker", provider: "codex", sessionKind: "worker" }),
    ).toBe(false);
    expect(
      isPinnableTimelineSession({ ...base, kind: "session", sessionId: "claude:worker", provider: "claude", sessionKind: "worker" }),
    ).toBe(false);
  });
});

describe("날짜 → 프로젝트 2단 그룹", () => {
  const day = (ts: number) => (ts >= 200 ? "2026-07-11" : "2026-07-10");
  const key = (e: TimelineEvent) => e.projectId ?? NONE_KEY;
  const name = (e: TimelineEvent) => e.projectId ?? "프로젝트 없음";
  const ev = (ts: number, projectId: `claude:${string}` | null): TimelineEvent => ({
    ...base,
    ts,
    projectId,
    kind: "session",
    sessionId: `claude:s-${ts}`,
  });

  it("하루 안에서 프로젝트별로 접고, 최근 활동이 있는 프로젝트를 위로 올린다", () => {
    // 최신순 입력(서버가 이미 내림차순으로 준다). alpha가 220으로 더 최근이므로 beta보다 위여야 한다.
    const days = groupTimelineByDayAndProject(
      [ev(220, "claude:alpha"), ev(210, "claude:beta"), ev(205, "claude:alpha"), ev(150, "claude:beta")],
      key,
      name,
      day,
    );

    expect(days.map((d) => d.day)).toEqual(["2026-07-11", "2026-07-10"]);
    expect(days[0].projects.map((p) => ({ key: p.key, count: p.items.length }))).toEqual([
      { key: "claude:alpha", count: 2 },
      { key: "claude:beta", count: 1 },
    ]);
    expect(days[1].projects.map((p) => p.key)).toEqual(["claude:beta"]);
    // 같은 프로젝트는 어느 날짜에서든 같은 색을 받아야 눈이 색으로 프로젝트를 기억할 수 있다.
    expect(days[0].projects[1].tone).toBe(days[1].projects[0].tone);
  });

  it("프로젝트 없는 이벤트는 하루의 맨 뒤로 민다", () => {
    const days = groupTimelineByDayAndProject([ev(230, null), ev(210, "claude:alpha")], key, name, day);

    expect(days[0].projects.map((p) => p.key)).toEqual(["claude:alpha", NONE_KEY]);
  });
});

describe("실행 중 세션 프로젝트 그룹핑", () => {
  const live = (id: string, projectId: string | null, updatedAt: string): LiveSession =>
    ({ id, projectId, updatedAt, detectedAt: updatedAt }) as LiveSession;

  it("프로젝트별로 묶고 최신 활동 그룹을 앞에, 프로젝트 없음은 맨 뒤에 둔다", () => {
    // getLiveSessions가 최신순 정렬을 보장하므로 입력도 최신순이다.
    const sessions = [
      live("claude:a", "claude:proj-a", "2026-07-11T10:00:00.000Z"),
      live("codex:n", null, "2026-07-11T09:30:00.000Z"),
      live("claude:b", "claude:proj-b", "2026-07-11T09:00:00.000Z"),
      live("claude:a2", "claude:proj-a", "2026-07-11T08:00:00.000Z"),
    ];

    const groups = groupLiveSessionsByProject(
      sessions,
      (s) => s.projectId ?? NONE_KEY,
      (s) => s.projectId ?? "프로젝트 없음",
    );

    expect(groups.map((g) => [g.key, g.items.map((s) => s.id)])).toEqual([
      ["claude:proj-a", ["claude:a", "claude:a2"]],
      ["claude:proj-b", ["claude:b"]],
      [NONE_KEY, ["codex:n"]],
    ]);
    expect(groups[0].name).toBe("claude:proj-a");
    expect(groups[2].name).toBe("프로젝트 없음");
    expect(groups[0].tone).toBeTruthy();
  });
});

describe("실행 중 세션 상태 문구", () => {
  const live = (activity: LiveSession["activity"]): LiveSession =>
    ({ activity }) as LiveSession;

  it("사용자 액션을 기다리는 상태를 작업 중과 다르게 설명한다", () => {
    expect(activityDetailText(live({ state: "working", since: null, tool: "Bash" }))).toBe("Bash 실행 중");
    expect(activityDetailText(live({ state: "working", since: null, tool: null }))).toBe("응답 생성 중");
    expect(activityDetailText(live({ state: "awaiting-approval", since: null, tool: "ExitPlanMode" }))).toBe(
      "계획을 제출하고 승인을 기다리는 중",
    );
    expect(activityDetailText(live({ state: "unknown", since: null, tool: null }))).toBeNull();
  });

  it("상태 지속 시간을 사람이 읽는 단위로 준다", () => {
    const now = Date.parse("2026-07-11T10:00:00.000Z");
    expect(elapsedLabel("2026-07-11T09:59:30.000Z", now)).toBe("30초째");
    expect(elapsedLabel("2026-07-11T09:56:00.000Z", now)).toBe("4분째");
    expect(elapsedLabel("2026-07-11T08:35:00.000Z", now)).toBe("1시간 25분째");
    expect(elapsedLabel(null, now)).toBeNull();
  });
});
