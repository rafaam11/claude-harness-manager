import { describe, expect, it } from "vitest";
import { computeRepoGroups } from "./repo-group.js";
import type { ProjectRecall } from "./recall.js";

// 존재하지 않는 경로를 쓰면 computeTopology의 fs.access가 실패해 git CLI 호출 없이 orphan이 된다
// (크로스플랫폼·빠름). recall.cwd가 있어야 realPath가 신뢰(reliable)로 간주된다.
function mkRecall(id: string, cwd: string, lastActivity: number): ProjectRecall {
  return {
    id,
    realPath: cwd,
    gitBranch: null,
    lastActivity,
    staleDays: 0,
    recall: {
      sessionId: id,
      sessionKind: "main",
      aiTitle: null,
      lastPrompt: null,
      lastAssistantSnippet: null,
      cwd,
      gitBranch: null,
      lastModel: null,
      transcriptPath: id,
      transcriptMtime: lastActivity,
      truncatedScan: false,
    },
    todos: null,
  };
}

describe("computeRepoGroups broad-dir orphan absorption", () => {
  it("does not absorb a non-git subfolder into a broad-dir (drive root) anchor", async () => {
    // 드라이브 루트(broad)에서 연 세션이 그 아래 non-git 하위폴더를 흡수하면 안 된다.
    // 실제 버그: 홈(C:\Users\PC)에서 연 hidden 세션이 하위 모든 프로젝트를 빨아들여 숨김.
    const recalls = [
      mkRecall("Z--", "Z:\\", 200), // 드라이브 루트 = broad 앵커, non-git orphan
      mkRecall("Z---nova-strat", "Z:\\nova\\strat", 100), // 하위 non-git orphan
    ];

    const groups = await computeRepoGroups(recalls);

    // 흡수되면 1그룹(broad 대표 아래로 딸려감). 흡수 안 하면 2그룹(각자 단독 카드).
    expect(groups).toHaveLength(2);
    const strat = groups.find((g) => g.memberIds.includes("Z---nova-strat"));
    expect(strat?.canonicalId).toBe("Z---nova-strat");
  });

  it("still folds a non-git subfolder into a non-broad parent by id prefix", async () => {
    // 정당한 부모(비-broad)에는 여전히 하위폴더가 접혀야 한다(회귀 방지).
    const recalls = [
      mkRecall("D--proj-app", "D:\\proj\\app", 200), // 일반 프로젝트(비-broad)
      mkRecall("D--proj-app-docs", "D:\\proj\\app\\docs", 100), // 그 하위폴더
    ];

    const groups = await computeRepoGroups(recalls);

    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toContain("D--proj-app-docs");
  });
});
