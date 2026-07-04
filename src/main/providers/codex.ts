import os from "node:os";
import path from "node:path";
import { detectProcess } from "../lib/process-detect.js";
import type { ProviderAdapter } from "./types.js";

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const CODEX_CONFIG = path.join(CODEX_HOME, "config.toml");

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  roots: { home: CODEX_HOME, configFiles: [CODEX_CONFIG] },
  async listConfigFiles() {
    return [
      {
        id: "codex-config",
        provider: "codex",
        label: "config.toml",
        path: CODEX_CONFIG,
        format: "toml",
        scope: "user",
        writable: true,
      },
    ];
  },
  async readMcpServers() {
    return [];
  },
  async listCatalog() {
    return [];
  },
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
    return detectProcess(
      process.platform === "win32" ? ["Codex.exe", "codex.exe"] : ["Codex", "codex"],
    );
  },
};
