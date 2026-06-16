import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOME, CONFIG_FILES, STALE_DAYS } from "../config.js";
import { readConfig, safeWrite, listBackups, restoreBackup } from "../lib/safe-write.js";
import { detectClaude } from "../lib/cc-detect.js";
import { archiveItems, restoreItem, listManifests } from "../lib/archive.js";
import { getCatalog, readCatalogContent } from "../services/catalog.js";
import { getPlugins } from "../services/plugins.js";
import { getProjects, listProjectFiles, readProjectFile } from "../services/projects.js";
import { scanCandidates } from "../services/scan.js";
import { getMcpServers } from "../services/mcp.js";
import { getWorkspaceProjects, getEnrichedPlans, getTimeline } from "../services/recall.js";
import { readPlanContent } from "../services/plans.js";
import { setPlanField, setProjectField } from "../lib/board.js";

function configEntry(name: string) {
  const entry = CONFIG_FILES[name];
  if (!entry) throw Object.assign(new Error(`unknown config: ${name}`), { statusCode: 404 });
  return entry;
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/api/overview", async () => {
    const [catalog, plugins, projects, candidates, cc] = await Promise.all([
      getCatalog(),
      getPlugins(),
      getProjects(),
      scanCandidates(),
      detectClaude(),
    ]);
    const harnessMd = await fs
      .readFile(path.join(CLAUDE_HOME, "HARNESS.md"), "utf8")
      .catch(() => "");
    const lastAudit = harnessMd.match(/\*\*마지막 점검일\*\*:\s*([0-9-]+)/)?.[1] ?? null;
    return {
      skills: catalog.filter((c) => c.kind === "skill").length,
      agents: catalog.filter((c) => c.kind === "agent").length,
      commands: catalog.filter((c) => c.kind === "command").length,
      agentWarnings: catalog.filter((c) => c.warn).length,
      plugins: plugins.plugins.length,
      projects: projects.length,
      staleProjects: projects.filter((p) => p.staleDays >= STALE_DAYS).length,
      cleanupCandidates: candidates.filter((c) => c.category !== "warn-only").length,
      lastAudit,
      ccRunning: cc.running,
    };
  });

  app.get("/api/cc-status", async () => detectClaude());

  // --- configs ---
  app.get("/api/configs/:name", async (req) => {
    const { name } = req.params as { name: string };
    const entry = configEntry(name);
    const data = await readConfig(entry.path);
    return { ...data, writable: entry.writable, path: entry.path };
  });

  app.put("/api/configs/:name", async (req, reply) => {
    const { name } = req.params as { name: string };
    const entry = configEntry(name);
    if (!entry.writable) {
      return reply.code(403).send({
        error: ".claude.json은 읽기 전용입니다 (CC가 상시 재작성 — 수동 절차 사용)",
      });
    }
    const { content, baseHash } = req.body as { content: string; baseHash: string };
    if (typeof content !== "string" || typeof baseHash !== "string") {
      return reply.code(400).send({ error: "content/baseHash 필요" });
    }
    return safeWrite(name, entry.path, content, baseHash);
  });

  app.get("/api/configs/:name/backups", async (req) => {
    const { name } = req.params as { name: string };
    const entry = configEntry(name);
    return listBackups(path.basename(entry.path));
  });

  app.post("/api/configs/:name/restore", async (req, reply) => {
    const { name } = req.params as { name: string };
    const entry = configEntry(name);
    if (!entry.writable) return reply.code(403).send({ error: "읽기 전용 파일" });
    const { backup } = req.body as { backup: string };
    if (!backup) return reply.code(400).send({ error: "backup 필요" });
    return restoreBackup(name, entry.path, backup);
  });

  // --- catalog / plugins / projects ---
  app.get("/api/catalog", async () => getCatalog());

  app.get("/api/catalog/content", async (req, reply) => {
    const { path: filePath } = req.query as { path?: string };
    if (!filePath) return reply.code(400).send({ error: "path 필요" });
    return readCatalogContent(filePath);
  });

  app.get("/api/plugins", async () => getPlugins());
  app.get("/api/projects", async () => getProjects());

  app.get("/api/mcp", async () => getMcpServers());

  app.get("/api/projects/:id/files", async (req) => {
    const { id } = req.params as { id: string };
    return listProjectFiles(id);
  });

  app.get("/api/projects/:id/file", async (req) => {
    const { id } = req.params as { id: string };
    const { path: rel } = req.query as { path: string };
    return readProjectFile(id, rel);
  });

  // --- workspace (작업 회상 대시보드) ---
  app.get("/api/workspace/projects", async () => getWorkspaceProjects());

  app.get("/api/workspace/plans", async (req) => {
    const { archived } = req.query as { archived?: string };
    return getEnrichedPlans(archived === "1");
  });

  app.get("/api/workspace/plan/content", async (req, reply) => {
    const { filename, archived } = req.query as { filename?: string; archived?: string };
    if (!filename) return reply.code(400).send({ error: "filename 필요" });
    return readPlanContent(filename, archived === "1");
  });

  app.get("/api/workspace/timeline", async (req) => {
    const { archived } = req.query as { archived?: string };
    return getTimeline(archived === "1");
  });

  app.post("/api/workspace/board/plan/:filename", async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (!filename) return reply.code(400).send({ error: "filename 필요" });
    const { status, memo, projectOverride } = req.body as {
      status?: string;
      memo?: string;
      projectOverride?: string | null;
    };
    return setPlanField(filename, { status, memo, projectOverride });
  });

  app.post("/api/workspace/board/project/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!id) return reply.code(400).send({ error: "id 필요" });
    const { status, memo } = req.body as { status?: string; memo?: string };
    return setProjectField(id, { status, memo });
  });

  // --- cleanup ---
  app.post("/api/cleanup/scan", async () => scanCandidates());

  app.post("/api/cleanup/execute", async (req, reply) => {
    const { items, dryRun = true } = req.body as {
      items: { path: string; reason: string; category: string }[];
      dryRun?: boolean;
    };
    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(400).send({ error: "items 필요" });
    }
    if (items.some((i) => i.category === "warn-only")) {
      return reply.code(400).send({ error: "warn-only 항목은 이동할 수 없습니다" });
    }
    if (dryRun) {
      return { dryRun: true, wouldMove: items.map((i) => ({ from: i.path, category: i.category })) };
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
  });

  app.post("/api/cleanup/restore", async (req, reply) => {
    const { archivedPath } = req.body as { archivedPath: string };
    if (!archivedPath) return reply.code(400).send({ error: "archivedPath 필요" });
    return restoreItem(archivedPath);
  });

  app.get("/api/cleanup/manifest", async () => listManifests());
}
