// 워크트리·하위폴더 그룹핑. Claude Code는 cwd마다 별도 ~/.claude/projects 디렉토리를 만들어,
// 같은 저장소의 워크트리(및 repo 하위 디렉토리)가 각각 별도 프로젝트로 잡힌다. 여기서 git 저장소
// 정체성(git-common-dir)으로 이들을 한 대표(repo)로 접는다.
//
// 핵심 원리: 그룹핑 키는 "경로 문자열 접두사"가 아니라 "공유하는 .git(common-dir)"이다. 따라서
// 서로 다른 repo는 절대 합쳐지지 않는다(중첩 repo도 git이 가장 가까운 .git으로 해석). 무언가가
// 홈으로 접히려면 홈 자체가 git repo여야만 하고, 그 경우도 BROAD_DIRS 블록리스트로 차단한다.
import fs from "node:fs/promises";
import path from "node:path";
import { BROAD_DIRS, REPO_TOPOLOGY_CACHE_TTL_MS } from "../config.js";
import { normalizePathKey } from "../lib/path-normalize.js";
import { execGit } from "./git/GitService.js";
import type { ProjectRecall } from "./recall.js";

/** 대표 repo 카드 아래에 나열/전환 대상이 되는 linked 워크트리. */
export interface WorktreeMember {
  projectId: string; // 이 워크트리의 대표 세션 projectId(board/plan 키)
  worktreeRoot: string; // 워킹트리 toplevel 절대경로(원본 케이스, Git 전환 대상)
  name: string; // 마지막 경로 세그먼트(diary-media-atlas 등)
  gitBranch: string | null;
  lastActivity: number;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  removed: boolean; // 디스크에서 사라진(pruned) 워크트리
}

/** 한 git 저장소(공유 .git)로 묶인 프로젝트 그룹. representative가 목록에 뜨는 대표 카드다. */
export interface RepoGroup {
  canonicalId: string; // 대표 projectId(board/plan/git 키) — 메인 repo id 우선
  repoRoot: string | null; // 메인 워킹트리 루트(표시 경로, 원본 케이스)
  isWorktree: boolean; // 대표가 (메인이 아닌) 워크트리인가(메인 세션이 아예 없을 때만 true)
  worktreeName: string | null; // 대표가 워크트리면 그 이름
  worktrees: WorktreeMember[]; // 대표 제외 linked 워크트리(최근활동순)
  memberIds: string[]; // 그룹에 속한 모든 projectId(board 상속·plan 필터용)
  representative: ProjectRecall; // 표시용으로 보정된 대표 recall(id=canonicalId, realPath=repoRoot, 최신 세션 반영)
}

/** git 저장소 토폴로지. commonDir(정체성)·worktreeRoot(이 워킹트리)·isWorktree(linked 여부). */
export interface RepoTopology {
  commonDir: string;
  worktreeRoot: string;
  isWorktree: boolean;
}

// --- 경로 정규화/판별 헬퍼 ---
// 케이스 처리는 플랫폼별(lib/path-normalize) — Linux는 케이스가 다르면 별개 경로다.
const norm = normalizePathKey;

const BROAD_SET = new Set(BROAD_DIRS.map(norm));
/** 접기 앵커 금지 디렉토리: 명시 블록리스트 + 드라이브 루트(c:) + unix 루트. */
function isBroadDir(normalized: string): boolean {
  if (BROAD_SET.has(normalized)) return true;
  if (/^[a-z]:$/.test(normalized)) return true; // C:\ → "c:"
  if (normalized === "" || normalized === "/") return true;
  return false;
}

function baseName(normalized: string): string {
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : normalized;
}

// "…/worktrees/<name>" 형태(삭제된 워크트리 루트 판별용). 더 깊은 하위폴더는 매치 안 됨.
const WORKTREE_ROOT_RE = /[\\/]worktrees[\\/][^\\/]+$/i;

/**
 * 정규화된 target 경로의 "원본 케이스"를, target을 접두사로 갖는 recall.realPath에서 복원한다.
 * (norm은 소문자화하므로 표시/Git cwd엔 원본 케이스가 필요하다. 못 찾으면 target 그대로.)
 */
function realCase(target: string, recalls: ProjectRecall[]): string {
  for (const r of recalls) {
    if (!r.realPath) continue;
    const rp = r.realPath.replace(/\\/g, "/"); // norm과 같은 길이(케이스 처리만 차이)
    const n = norm(r.realPath);
    if (n === target) return rp;
    if (n.startsWith(target + "/")) return rp.slice(0, target.length);
  }
  return target;
}

// --- 토폴로지 해석(TTL 캐시) ---
// git 토폴로지는 사실상 안정적이라 REPO_TOPOLOGY_CACHE_TTL_MS만큼 오래 캐시한다(realPath 기준).
// TTL 없이 영구 캐시하면 워크트리 생성/삭제 등 구조 변화가 앱을 껐다 켜기 전까진 전혀
// 반영되지 않으므로, 만료 후에는 재계산해 자가 치유되게 한다.
const topoCache = new Map<string, { value: RepoTopology | null; ts: number }>();

export async function resolveRepoTopology(realPath: string | null): Promise<RepoTopology | null> {
  if (!realPath) return null;
  const key = norm(realPath);
  const cached = topoCache.get(key);
  if (cached !== undefined && Date.now() - cached.ts < REPO_TOPOLOGY_CACHE_TTL_MS) {
    return cached.value;
  }
  const result = await computeTopology(realPath);
  topoCache.set(key, { value: result, ts: Date.now() });
  return result;
}

async function computeTopology(realPath: string): Promise<RepoTopology | null> {
  // 존재하지 않는 경로(삭제된 워크트리 등)는 git 호출 전에 걸러 폴백으로 넘긴다.
  const exists = await fs
    .access(realPath)
    .then(() => true)
    .catch(() => false);
  if (!exists) return null;
  try {
    const toplevel = (await execGit(realPath, ["rev-parse", "--show-toplevel"])).trim();
    if (!toplevel) return null;
    const gitDir = (await execGit(realPath, ["rev-parse", "--absolute-git-dir"])).trim();
    const commonRaw = (await execGit(realPath, ["rev-parse", "--git-common-dir"])).trim();
    // --git-common-dir는 상대(.git)로 나올 수 있어 realPath 기준 절대화한다.
    // (MIN_GIT_VERSION 2.23 → --path-format=absolute(2.31+) 사용 불가)
    const commonAbs = norm(path.resolve(realPath, commonRaw));
    return {
      commonDir: commonAbs,
      worktreeRoot: norm(toplevel),
      isWorktree: norm(gitDir) !== commonAbs,
    };
  } catch {
    return null; // 비-git
  }
}

// --- 그룹 계산 ---
function pickNewest(recalls: ProjectRecall[]): ProjectRecall {
  return recalls.reduce((a, b) => (b.lastActivity > a.lastActivity ? b : a));
}

interface WTNode {
  worktreeRoot: string; // 정규화
  commonDir: string | null; // null이면 저장소 그룹핑에서 제외(단독)
  isWorktree: boolean;
  recalls: ProjectRecall[];
}

export async function computeRepoGroups(recalls: ProjectRecall[]): Promise<RepoGroup[]> {
  // realPath는 transcript cwd(신뢰) 또는 guessOriginalPath(부정확한 추정)에서 온다. recall.cwd가
  // 있을 때만 realPath가 믿을 만하다 — 없으면 추정 경로라 git 해석/경로매칭에 쓰지 않고 id 접두사로만 접는다.
  const items = recalls.map((r) => {
    const reliable = !!(r.recall && r.recall.cwd);
    return { r, reliable, rp: reliable && r.realPath ? norm(r.realPath) : null };
  });
  // 신뢰 경로만 git 토폴로지 해석(추정 경로에 git 호출 낭비/오탐 방지).
  const topos = await Promise.all(
    items.map((it) => (it.reliable ? resolveRepoTopology(it.r.realPath) : Promise.resolve(null))),
  );

  // 1) 해석 성공 recall을 워킹트리 노드로 접는다(key = worktreeRoot, 하위폴더도 같은 노드).
  //    broad 앵커(홈 등)는 접기 금지 → 자기 경로로 단독. 나머지(추정경로/삭제/비-git)는 orphan.
  const nodes = new Map<string, WTNode>();
  const orphans: { r: ProjectRecall; realCwd: string | null }[] = [];
  items.forEach((it, i) => {
    const topo = topos[i];
    if (!topo || !it.rp) {
      orphans.push({ r: it.r, realCwd: it.reliable ? it.r.realPath : null });
      return;
    }
    if (isBroadDir(topo.worktreeRoot)) {
      nodes.set("solo:" + it.r.id, {
        worktreeRoot: it.rp,
        commonDir: null,
        isWorktree: false,
        recalls: [it.r],
      });
    } else {
      const n =
        nodes.get(topo.worktreeRoot) ?? {
          worktreeRoot: topo.worktreeRoot,
          commonDir: topo.commonDir,
          isWorktree: topo.isWorktree,
          recalls: [],
        };
      n.recalls.push(it.r);
      nodes.set(topo.worktreeRoot, n);
    }
  });

  // 2) 노드를 commonDir(저장소 정체성)로 그룹핑. commonDir=null(broad/단독)은 각자 단일 그룹.
  const byCommon = new Map<string, WTNode[]>();
  const soloNodes: WTNode[] = [];
  for (const n of nodes.values()) {
    if (n.commonDir) {
      const arr = byCommon.get(n.commonDir) ?? [];
      arr.push(n);
      byCommon.set(n.commonDir, arr);
    } else soloNodes.push(n);
  }

  const groups: RepoGroup[] = [];
  for (const [commonDir, groupNodes] of byCommon) {
    // 메인 워킹트리 루트: commonDir이 "…/.git"이면 그 부모. 그 루트 노드가 대표.
    const mainRoot = commonDir.endsWith("/.git") ? commonDir.slice(0, -"/.git".length) : null;
    const mainNode = mainRoot ? groupNodes.find((n) => n.worktreeRoot === mainRoot) ?? null : null;
    // 메인 세션이 없으면(워크트리에서만 작업) 최근활동 노드를 대표로.
    const repNode =
      mainNode ??
      groupNodes.reduce((a, b) =>
        pickNewest(b.recalls).lastActivity > pickNewest(a.recalls).lastActivity ? b : a,
      );
    // 워크트리는 "실제 Claude 세션이 있는 것"만 노출한다(세션 없는 라이브 워크트리는 회상에 무의미).
    const memberNodes = groupNodes.filter((n) => n !== repNode);
    groups.push(
      buildGroup(repNode, memberNodes, mainRoot ?? repNode.worktreeRoot, mainNode === null),
    );
  }
  for (const n of soloNodes) groups.push(buildGroup(n, [], n.worktreeRoot, false));

  // 3) 해석 실패 recall(추정경로/삭제된 워크트리)을 flatten-id 접두사로 대표 그룹에 접는다.
  //    Claude Code는 하위 cwd의 flatten id를 부모 id + "-…"로 만들므로 경로 존재와 무관하게 견고하다.
  //    단, broad 앵커(홈/Desktop/드라이브 루트 등)에는 접지 않는다 — Step 1의 isBroadDir 차단과 같은
  //    원칙으로, 홈에서 연 세션 하나가 그 아래 모든 non-git 프로젝트를 흡수(대표가 숨김이면 하위가
  //    통째로 목록에서 사라짐)하는 것을 막는다.
  const isBroadAnchor = (g: RepoGroup) => !!g.repoRoot && isBroadDir(norm(g.repoRoot));
  for (const { r, realCwd } of orphans) {
    // 가장 긴 접두사 memberId를 가진 그룹에 붙인다(가장 구체적인 부모).
    let best: RepoGroup | null = null;
    let bestLen = -1;
    for (const g of groups) {
      if (isBroadAnchor(g)) continue;
      for (const mid of g.memberIds) {
        if (mid.length > bestLen && r.id.startsWith(mid + "-")) {
          best = g;
          bestLen = mid.length;
        }
      }
    }
    // 경로 접두사 폴백(신뢰 경로일 때만) — id 접두사가 안 맞는 드문 경우.
    if (!best && realCwd) {
      const rp = norm(realCwd);
      best =
        groups.find(
          (g) =>
            !isBroadAnchor(g) &&
            ((g.repoRoot && (rp === norm(g.repoRoot) || rp.startsWith(norm(g.repoRoot) + "/"))) ||
              g.worktrees.some(
                (w) => rp === norm(w.worktreeRoot) || rp.startsWith(norm(w.worktreeRoot) + "/"),
              )),
        ) ?? null;
    }
    if (best) {
      if (!best.memberIds.includes(r.id)) best.memberIds.push(r.id);
      // 삭제된 "워크트리 루트"만 워크트리 행으로 노출(신뢰 경로 + worktrees/<name> 형태). 하위폴더는 조용히 접기.
      // 라이브 목록(best.worktrees)·메인 경로에 이미 있으면 중복 추가하지 않는다.
      if (realCwd && WORKTREE_ROOT_RE.test(realCwd)) {
        const nrp = norm(realCwd);
        const dup = nrp === norm(best.repoRoot ?? "") || best.worktrees.some((w) => norm(w.worktreeRoot) === nrp);
        if (!dup) {
          best.worktrees.push({
            projectId: r.id,
            worktreeRoot: realCwd.replace(/\\/g, "/"),
            name: baseName(nrp),
            gitBranch: r.gitBranch,
            lastActivity: r.lastActivity,
            lastPrompt: r.recall?.lastPrompt ?? null,
            lastAssistantSnippet: r.recall?.lastAssistantSnippet ?? null,
            removed: true,
          });
          best.worktrees.sort((a, b) => b.lastActivity - a.lastActivity);
        }
      }
    } else {
      groups.push({
        canonicalId: r.id,
        repoRoot: r.realPath,
        isWorktree: false,
        worktreeName: null,
        worktrees: [],
        memberIds: [r.id],
        representative: r,
      });
    }
  }

  return groups.sort((a, b) => b.representative.lastActivity - a.representative.lastActivity);
}

function buildGroup(
  repNode: WTNode,
  memberNodes: WTNode[],
  mainRootNorm: string,
  repIsWorktree: boolean,
): RepoGroup {
  const allNodes = [repNode, ...memberNodes];
  const allRecalls = allNodes.flatMap((n) => n.recalls);
  // 그룹 전체(대표+멤버)의 가장 최근 세션 = 카드 스니펫/활동(resume 회상용).
  const groupNewest = pickNewest(allRecalls);
  const lastActivity = Math.max(...allRecalls.map((r) => r.lastActivity));
  const repoRoot = realCase(mainRootNorm, allRecalls);

  // canonicalId: 대표 노드의 루트 세션(realPath==worktreeRoot) 우선, 없으면 최신.
  const repRootRecall =
    repNode.recalls.find((r) => r.realPath && norm(r.realPath) === repNode.worktreeRoot) ??
    pickNewest(repNode.recalls);

  const memberWorktrees: WorktreeMember[] = memberNodes.map((n) => {
    const newest = pickNewest(n.recalls);
    return {
      projectId: newest.id,
      worktreeRoot: realCase(n.worktreeRoot, n.recalls),
      name: baseName(n.worktreeRoot),
      gitBranch: newest.gitBranch,
      lastActivity: Math.max(...n.recalls.map((r) => r.lastActivity)),
      lastPrompt: newest.recall?.lastPrompt ?? null,
      lastAssistantSnippet: newest.recall?.lastAssistantSnippet ?? null,
      removed: false,
    };
  });

  // 노드당 대표(memberNode는 최신 하나, repNode는 루트 세션)로 뽑히지 않은 recall은 같은
  // 트리의 다른 cwd에서 실행된 세션이다 — 예전엔 조용히 버려져 Workspace 카드/워크트리
  // 목록 어디에도 안 보였다(Timeline에만 남음). worktreeRoot를 자기 realPath로 두면
  // resolveWorktreePath가 결국 같은 저장소 toplevel로 안전하게 resolve하므로, 실제
  // 워크트리와 동일한 방식으로 노출해도 다른 저장소로 오인식될 위험이 없다.
  const leftoverToMember = (r: ProjectRecall): WorktreeMember => {
    const root = r.realPath ?? r.id;
    return {
      projectId: r.id,
      worktreeRoot: root,
      name: baseName(norm(root)),
      gitBranch: r.gitBranch,
      lastActivity: r.lastActivity,
      lastPrompt: r.recall?.lastPrompt ?? null,
      lastAssistantSnippet: r.recall?.lastAssistantSnippet ?? null,
      removed: false,
    };
  };
  const leftoverWorktrees: WorktreeMember[] = [
    ...repNode.recalls.filter((r) => r !== repRootRecall).map(leftoverToMember),
    ...memberNodes.flatMap((n) => {
      const newest = pickNewest(n.recalls);
      return n.recalls.filter((r) => r !== newest).map(leftoverToMember);
    }),
  ];
  const worktrees: WorktreeMember[] = [...memberWorktrees, ...leftoverWorktrees].sort(
    (a, b) => b.lastActivity - a.lastActivity,
  );

  const representative: ProjectRecall = {
    ...groupNewest,
    id: repRootRecall.id, // board/plan/git 키는 메인 repo id
    realPath: repoRoot,
    lastActivity,
  };

  return {
    canonicalId: repRootRecall.id,
    repoRoot,
    isWorktree: repIsWorktree,
    worktreeName: repIsWorktree ? baseName(repNode.worktreeRoot) : null,
    worktrees,
    memberIds: allNodes.flatMap((n) => n.recalls.map((r) => r.id)),
    representative,
  };
}

