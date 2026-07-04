import { CLAUDE_HOME, CLAUDE_JSON, CONFIG_FILES } from "../config.js";
import { detectClaude } from "../lib/cc-detect.js";
import { getCatalog } from "../services/catalog.js";
import { getMcpServers } from "../services/mcp.js";
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
    return [];
  },
  async listSessions() {
    return [];
  },
  async listPlans() {
    return [];
  },
  async detectRunning() {
    return (await detectClaude()).running;
  },
};
