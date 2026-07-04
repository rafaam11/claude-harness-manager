import { describe, expect, it } from "vitest";
import { resolveProviderWorkspaceSelection } from "./Workspace";
import type { NormalizedProject, NormalizedTimelineEvent } from "@shared/provider-types";

describe("provider workspace selection", () => {
  it("revalidates a stale selectedId against the current project list", () => {
    const projects: NormalizedProject[] = [
      {
        id: "claude:alpha",
        provider: "claude",
        localId: "alpha",
        title: "Alpha",
        realPath: null,
        latestActivityAt: null,
      },
      {
        id: "codex:beta",
        provider: "codex",
        localId: "beta",
        title: "Beta",
        realPath: null,
        latestActivityAt: null,
      },
    ];
    const eventGroups = new Map<string, NormalizedTimelineEvent[]>();

    expect(resolveProviderWorkspaceSelection("codex:stale", projects, eventGroups)).toBe("claude:alpha");
  });
});
