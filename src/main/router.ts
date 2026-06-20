import path from "node:path";
import { CONFIG_FILES } from "./config.js";
import { readConfig, safeWrite, listBackups, restoreBackup } from "./lib/safe-write.js";
import { detectClaude } from "./lib/cc-detect.js";
import { archiveItems, restoreItem, listManifests } from "./lib/archive.js";
import { getCatalog, readCatalogContent } from "./services/catalog.js";
import { getPlugins } from "./services/plugins.js";
import { getProjects, listProjectFiles, readProjectFile } from "./services/projects.js";
import { scanCandidates } from "./services/scan.js";
import { getMcpServers } from "./services/mcp.js";
import { getWorkspaceProjects, getEnrichedPlans, getTimeline } from "./services/recall.js";
import { readPlanContent } from "./services/plans.js";
import { setPlanField, setProjectField, setSessionField, type ProjectTrack } from "./lib/board.js";
import type { ApiMethod, ApiRequest } from "@shared/types";

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
      const { status, memo, nameOverride, tracks } = body as {
        status?: string;
        memo?: string;
        nameOverride?: string | null;
        tracks?: ProjectTrack[];
      };
      return setProjectField(params.id, { status, memo, nameOverride, tracks });
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
];

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
