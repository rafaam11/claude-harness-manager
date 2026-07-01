import path from "node:path";
import { CONFIG_FILES } from "./config.js";
import { readConfig, safeWrite, listBackups, restoreBackup } from "./lib/safe-write.js";
import { detectClaude } from "./lib/cc-detect.js";
import { archiveItems, restoreItem, listManifests } from "./lib/archive.js";
import { getCatalog, readCatalogContent } from "./services/catalog.js";
import { readStampPlanSessionHook } from "./services/hooks.js";
import { getPlugins } from "./services/plugins.js";
import { getProjects, listProjectFiles, readProjectFile } from "./services/projects.js";
import { scanCandidates } from "./services/scan.js";
import { getMcpServers } from "./services/mcp.js";
import { getWorkspaceProjects, getEnrichedPlans, getTimeline, getPromptCorpus } from "./services/recall.js";
import { readCustomGlossary } from "./lib/glossary-custom.js";
import { readPlanContent } from "./services/plans.js";
import { getNews, refreshNews } from "./services/news.js";
import { translateItems } from "./services/translate.js";
import { hasDeepLKey, setDeepLKey } from "./lib/secrets.js";
import {
  setPlanField,
  setProjectField,
  setProjectsOrder,
  setSessionField,
  type ProjectTrack,
} from "./lib/board.js";
import * as git from "./services/git/index.js";
import type {
  ApiMethod,
  ApiRequest,
  CommitDiffRequest,
  DiffRequest,
  GitOpKind,
  GraphActionRequest,
  NewsItem,
  SecretStatus,
  SetDeepLKeyRequest,
  StatusEntryKind,
  TranslateRequest,
} from "@shared/types";

/**
 * 의도적 상태코드를 들고 던지는 에러. 기존 Fastify 라우트의 `reply.code(n).send({error})` 자리를
 * `throw new HttpError(n, msg)`로 대체한다. lib/services가 이미 던지는 statusCode 보유 에러(path-guard 403,
 * safe-write 409, json-validate 422, archive 404, plans 400)는 변환 없이 그대로 통과한다.
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface Ctx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}
type Handler = (ctx: Ctx) => Promise<unknown> | unknown;
interface Route {
  method: ApiMethod;
  pattern: string;
  handler: Handler;
}

function configEntry(name: string) {
  const entry = CONFIG_FILES[name];
  if (!entry) throw new HttpError(404, `unknown config: ${name}`);
  return entry;
}

// 라우트 테이블. 기존 server/src/routes/index.ts 의 핸들러 본문을 그대로 이식했다.
const routes: Route[] = [
  { method: "GET", pattern: "/api/cc-status", handler: async () => detectClaude() },

  // --- news (라이브 뉴스 통합 피드) ---
  // GET은 캐시 조회(멱등), refresh는 네트워크 fetch+디스크 쓰기라 POST. 둘 다 throw 안 하고
  // 부분 실패를 응답의 sources[].ok로 전달한다(전 소스 실패해도 캐시/빈 피드 반환 → 페이지 생존).
  { method: "GET", pattern: "/api/news", handler: async () => getNews() },
  { method: "POST", pattern: "/api/news/refresh", handler: async () => refreshNews() },
  // 번역: 보이는/펼친 항목 id를 받아 미번역만 DeepL 호출. 부분 실패해도 200(성공분 반환).
  // id→item은 main이 현재 캐시 피드에서 해석한다(원문을 IPC로 왕복시키지 않음 = 신뢰 경계).
  {
    method: "POST",
    pattern: "/api/news/translate",
    handler: async ({ body }) => {
      const { ids, target = "ko", withBody = false } = body as Partial<TranslateRequest>;
      if (!Array.isArray(ids) || ids.length === 0) throw new HttpError(400, "ids 필요");
      if (target !== "ko") throw new HttpError(400, "지원하지 않는 target");
      const feed = await getNews();
      const byId = new Map(feed.items.map((i) => [i.id, i]));
      const items = ids.map((id) => byId.get(id)).filter((x): x is NewsItem => Boolean(x));
      return translateItems(items, { withBody: withBody === true });
    },
  },
  // DeepL 키 존재 여부(boolean만). 키 원문은 절대 반환하지 않는다.
  {
    method: "GET",
    pattern: "/api/app/secrets/deepl",
    handler: async (): Promise<SecretStatus> => ({ configured: await hasDeepLKey() }),
  },
  // DeepL 키 저장(빈 문자열이면 해제). 갱신된 존재 여부 반환.
  {
    method: "POST",
    pattern: "/api/app/secrets/deepl",
    handler: async ({ body }): Promise<SecretStatus> => {
      const { key } = body as Partial<SetDeepLKeyRequest>;
      if (typeof key !== "string") throw new HttpError(400, "key 필요");
      await setDeepLKey(key);
      return { configured: key.trim().length > 0 };
    },
  },

  // --- glossary (추천 어휘: 로컬 프롬프트 분석) ---
  // 최근 프롬프트 텍스트 corpus만 내려준다(외부 호출 0). 매칭은 renderer가 자기 용어집 데이터로 수행.
  {
    method: "GET",
    pattern: "/api/glossary/prompt-corpus",
    handler: async () => ({ texts: await getPromptCorpus() }),
  },
  // 커스텀 용어집(개인화) 읽기 — 사용자/CC가 채운 파일을 읽기 전용으로. 손상/없음에도 빈 값 생존.
  { method: "GET", pattern: "/api/glossary/custom", handler: async () => readCustomGlossary() },

  // --- configs ---
  {
    method: "GET",
    pattern: "/api/configs/:name",
    handler: async ({ params }) => {
      const entry = configEntry(params.name);
      const data = await readConfig(entry.path);
      return { ...data, writable: entry.writable, path: entry.path };
    },
  },
  {
    method: "PUT",
    pattern: "/api/configs/:name",
    handler: async ({ params, body }) => {
      const entry = configEntry(params.name);
      if (!entry.writable) {
        throw new HttpError(
          403,
          ".claude.json은 읽기 전용입니다 (CC가 상시 재작성 — 수동 절차 사용)",
        );
      }
      const { content, baseHash } = body as { content: string; baseHash: string };
      if (typeof content !== "string" || typeof baseHash !== "string") {
        throw new HttpError(400, "content/baseHash 필요");
      }
      return safeWrite(params.name, entry.path, content, baseHash);
    },
  },
  {
    method: "GET",
    pattern: "/api/configs/:name/backups",
    handler: async ({ params }) => {
      const entry = configEntry(params.name);
      return listBackups(path.basename(entry.path));
    },
  },
  {
    method: "POST",
    pattern: "/api/configs/:name/restore",
    handler: async ({ params, body }) => {
      const entry = configEntry(params.name);
      if (!entry.writable) throw new HttpError(403, "읽기 전용 파일");
      const { backup } = body as { backup: string };
      if (!backup) throw new HttpError(400, "backup 필요");
      return restoreBackup(params.name, entry.path, backup);
    },
  },

  // --- catalog / plugins / projects ---
  { method: "GET", pattern: "/api/catalog", handler: async () => getCatalog() },
  {
    method: "GET",
    pattern: "/api/catalog/content",
    handler: async ({ query }) => {
      const filePath = query.path;
      if (!filePath) throw new HttpError(400, "path 필요");
      return readCatalogContent(filePath);
    },
  },
  {
    method: "GET",
    pattern: "/api/hooks/stamp-plan-session",
    handler: async () => {
      try {
        return { content: await readStampPlanSessionHook() };
      } catch {
        throw new HttpError(404, "hook not installed on this PC");
      }
    },
  },
  { method: "GET", pattern: "/api/plugins", handler: async () => getPlugins() },
  { method: "GET", pattern: "/api/projects", handler: async () => getProjects() },
  { method: "GET", pattern: "/api/mcp", handler: async () => getMcpServers() },
  {
    method: "GET",
    pattern: "/api/projects/:id/files",
    handler: async ({ params }) => listProjectFiles(params.id),
  },
  {
    method: "GET",
    pattern: "/api/projects/:id/file",
    handler: async ({ params, query }) => readProjectFile(params.id, query.path),
  },

  // --- workspace (작업 회상 대시보드) ---
  { method: "GET", pattern: "/api/workspace/projects", handler: async () => getWorkspaceProjects() },
  {
    method: "GET",
    pattern: "/api/workspace/plans",
    handler: async ({ query }) => getEnrichedPlans(query.archived === "1"),
  },
  {
    method: "GET",
    pattern: "/api/workspace/plan/content",
    handler: async ({ query }) => {
      if (!query.filename) throw new HttpError(400, "filename 필요");
      return readPlanContent(query.filename, query.archived === "1");
    },
  },
  {
    method: "GET",
    pattern: "/api/workspace/timeline",
    handler: async ({ query }) => getTimeline(query.archived === "1"),
  },
  {
    method: "POST",
    pattern: "/api/workspace/board/plan/:filename",
    handler: async ({ params, body }) => {
      const { status, memo, projectOverride } = body as {
        status?: string;
        memo?: string;
        projectOverride?: string | null;
      };
      return setPlanField(params.filename, { status, memo, projectOverride });
    },
  },
  {
    method: "POST",
    pattern: "/api/workspace/board/project/:id",
    handler: async ({ params, body }) => {
      const { status, memo, nameOverride, tracks, repoPath, hidden, order } = body as {
        status?: string;
        memo?: string;
        nameOverride?: string | null;
        tracks?: ProjectTrack[];
        repoPath?: string | null;
        hidden?: boolean;
        order?: number | null;
      };
      return setProjectField(params.id, {
        status,
        memo,
        nameOverride,
        tracks,
        repoPath,
        hidden,
        order,
      });
    },
  },
  {
    method: "POST",
    pattern: "/api/workspace/board/projects/order",
    handler: async ({ body }) => {
      const { orders } = body as { orders?: Record<string, number> };
      return setProjectsOrder(orders ?? {});
    },
  },
  {
    method: "POST",
    pattern: "/api/workspace/board/session/:sessionId",
    handler: async ({ params, body }) => {
      const { status, memo } = body as { status?: string; memo?: string };
      return setSessionField(params.sessionId, { status, memo });
    },
  },

  // --- cleanup ---
  { method: "POST", pattern: "/api/cleanup/scan", handler: async () => scanCandidates() },
  {
    method: "POST",
    pattern: "/api/cleanup/execute",
    handler: async ({ body }) => {
      const { items, dryRun = true } = body as {
        items: { path: string; reason: string; category: string }[];
        dryRun?: boolean;
      };
      if (!Array.isArray(items) || items.length === 0) {
        throw new HttpError(400, "items 필요");
      }
      if (items.some((i) => i.category === "warn-only")) {
        throw new HttpError(400, "warn-only 항목은 이동할 수 없습니다");
      }
      if (dryRun) {
        return {
          dryRun: true,
          wouldMove: items.map((i) => ({ from: i.path, category: i.category })),
        };
      }
      const byCategory = new Map<string, { path: string; reason: string }[]>();
      for (const i of items) {
        const list = byCategory.get(i.category) ?? [];
        list.push({ path: i.path, reason: i.reason });
        byCategory.set(i.category, list);
      }
      const moved = [];
      for (const [category, list] of byCategory) {
        moved.push(...(await archiveItems(list, category)));
      }
      return { dryRun: false, moved };
    },
  },
  {
    method: "POST",
    pattern: "/api/cleanup/restore",
    handler: async ({ body }) => {
      const { archivedPath } = body as { archivedPath: string };
      if (!archivedPath) throw new HttpError(400, "archivedPath 필요");
      return restoreItem(archivedPath);
    },
  },
  { method: "GET", pattern: "/api/cleanup/manifest", handler: async () => listManifests() },

  // --- git (DT_GitManager 흡수: 로컬 git 작업) ---
  // 모든 라우트는 projectId만 받고 main(facade)에서 repoPath를 해석·검증한다.
  { method: "GET", pattern: "/api/git/version", handler: async () => git.gitVersion() },
  {
    method: "GET",
    pattern: "/api/git/resolve",
    handler: async ({ query }) => git.resolveRepo(reqProjectId(query)),
  },
  {
    method: "GET",
    pattern: "/api/git/status",
    handler: async ({ query }) => git.gitStatus(reqProjectId(query)),
  },
  {
    method: "GET",
    pattern: "/api/git/graph",
    handler: async ({ query }) =>
      git.gitGraph(reqProjectId(query), query.limit ? Number(query.limit) : undefined),
  },
  {
    method: "GET",
    pattern: "/api/git/branches",
    handler: async ({ query }) => git.gitBranches(reqProjectId(query)),
  },
  {
    method: "GET",
    pattern: "/api/git/in-progress",
    handler: async ({ query }) => git.gitInProgress(reqProjectId(query)),
  },
  {
    method: "GET",
    pattern: "/api/git/commit",
    handler: async ({ query }) => {
      if (!query.oid) throw new HttpError(400, "oid 필요");
      return git.gitCommitDetail(reqProjectId(query), query.oid);
    },
  },
  {
    method: "POST",
    pattern: "/api/git/diff",
    handler: async ({ body }) => {
      const b = body as Partial<DiffRequest>;
      if (!b.projectId || !b.path || !b.kind) throw new HttpError(400, "projectId/path/kind 필요");
      return git.gitDiff({
        projectId: b.projectId,
        path: b.path,
        staged: b.staged === true,
        kind: b.kind as StatusEntryKind,
      });
    },
  },
  {
    method: "POST",
    pattern: "/api/git/commit-diff",
    handler: async ({ body }) => {
      const b = body as Partial<CommitDiffRequest>;
      if (!b.projectId || !b.oid || !b.path) throw new HttpError(400, "projectId/oid/path 필요");
      return git.gitCommitDiff({
        projectId: b.projectId,
        oid: b.oid,
        parentOid: b.parentOid ?? null,
        path: b.path,
      });
    },
  },
  {
    method: "POST",
    pattern: "/api/git/stage",
    handler: async ({ body }) => git.gitStage(...reqPaths(body)),
  },
  {
    method: "POST",
    pattern: "/api/git/unstage",
    handler: async ({ body }) => git.gitUnstage(...reqPaths(body)),
  },
  {
    method: "POST",
    pattern: "/api/git/discard",
    handler: async ({ body }) => git.gitDiscard(...reqPaths(body)),
  },
  {
    method: "POST",
    pattern: "/api/git/commit",
    handler: async ({ body }) => {
      const { projectId, message } = body as { projectId?: string; message?: string };
      if (!projectId || typeof message !== "string") {
        throw new HttpError(400, "projectId/message 필요");
      }
      return git.gitCommit(projectId, message);
    },
  },
  {
    method: "POST",
    pattern: "/api/git/action",
    handler: async ({ body }) => {
      const b = body as Partial<GraphActionRequest>;
      if (!b.projectId || !b.kind) throw new HttpError(400, "projectId/kind 필요");
      return git.gitAction(b as GraphActionRequest);
    },
  },
  {
    method: "POST",
    pattern: "/api/git/remote",
    handler: async ({ body }) => {
      const { projectId, kind } = body as { projectId?: string; kind?: GitOpKind };
      if (!projectId || !kind) throw new HttpError(400, "projectId/kind 필요");
      return git.gitRemote(projectId, kind);
    },
  },
];

/** git 라우트 공용: query에서 projectId를 꺼내고 없으면 400. */
function reqProjectId(query: Record<string, string>): string {
  if (!query.projectId) throw new HttpError(400, "projectId 필요");
  return query.projectId;
}

/** stage/unstage/discard 공용: body에서 (projectId, paths)를 검증해 튜플로 반환. */
function reqPaths(body: unknown): [string, string[]] {
  const { projectId, paths } = body as { projectId?: string; paths?: string[] };
  if (!projectId || !Array.isArray(paths)) throw new HttpError(400, "projectId/paths 필요");
  return [projectId, paths];
}

/** "/api/configs/:name" 패턴을 실제 pathname에 매칭. 성공 시 params, 실패 시 null. */
function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const pSegs = pattern.split("/");
  const aSegs = pathname.split("/");
  if (pSegs.length !== aSegs.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pSegs.length; i++) {
    const p = pSegs[i];
    const a = aSegs[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(a);
    } else if (p !== a) {
      return null;
    }
  }
  return params;
}

/** IPC 요청을 라우트 테이블에 디스패치. 핸들러의 반환값을 그대로 돌려준다(에러는 throw). */
export async function routeRequest(req: ApiRequest): Promise<unknown> {
  const u = new URL(req.url, "app://local");
  const query = Object.fromEntries(u.searchParams);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const params = matchPattern(r.pattern, u.pathname);
    if (!params) continue;
    return r.handler({ params, query, body: req.body ?? {} });
  }
  throw new HttpError(404, `no route: ${req.method} ${u.pathname}`);
}
