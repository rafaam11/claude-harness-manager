import { CLAUDE_HOME, CLAUDE_JSON, CONFIG_FILES } from "../config.js";
import { detectClaude } from "../lib/cc-detect.js";
import { getCatalog } from "../services/catalog.js";
import { getMcpServers } from "../services/mcp.js";
import { getEnrichedPlans, getWorkspaceProjects } from "../services/recall.js";
import { prefixEntityId, splitEntityId } from "./registry.js";
import type { ProviderAdapter } from "./types.js";

export const claudeProvider: ProviderAdapter = {
  id: "claude",
  label: "Claude Code",
  roots: { home: CLAUDE_HOME, configFiles: [CLAUDE_JSON] },
  async listConfigFiles() {
    return Object.entries(CONFIG_FILES).map(([id, entry]) => ({
      id,
      provider: "claude",
      label: id,
      path: entry.path,
      format: "json" as const,
      scope: "user" as const,
      writable: entry.writable,
    }));
  },
  readMcpServers: getMcpServers,
  listCatalog: getCatalog,
  async listProjects() {
    const projects = await getWorkspaceProjects();
    return projects.map((p) => {
      const { localId } = splitEntityId(p.id);
      return {
        id: prefixEntityId("claude", localId),
        provider: "claude" as const,
        localId,
        title: p.board.nameOverride || p.realPath?.split(/[\\/]/).filter(Boolean).at(-1) || localId,
        realPath: p.realPath,
        latestActivityAt: p.lastActivity ? new Date(p.lastActivity).toISOString() : null,
      };
    });
  },
  async listSessions() {
    return [];
  },
  async listPlans() {
    const plans = await getEnrichedPlans(true);
    return plans.map((p) => ({
      id: prefixEntityId("claude", p.filename),
      provider: "claude" as const,
      title: p.title,
      sourcePath: p.path,
      updatedAt: new Date(p.mtime).toISOString(),
      archived: p.archived,
      projectId: p.projectId ? prefixEntityId("claude", splitEntityId(p.projectId).localId) : null,
    }));
  },
  async detectRunning() {
    return (await detectClaude()).running;
  },
};
