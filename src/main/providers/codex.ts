import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectProcess } from "../lib/process-detect.js";
import { readCodexMcpServersFromToml } from "../lib/toml-validate.js";
import type { ProviderAdapter } from "./types.js";

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const CODEX_CONFIG = path.join(CODEX_HOME, "config.toml");

async function statOrNull(p: string) {
  return fs.stat(p).catch(() => null);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function codexMemoryFiles(): Promise<string[]> {
  const memories = path.join(CODEX_HOME, "memories");
  return [path.join(memories, "memory_summary.md"), path.join(memories, "MEMORY.md")];
}

async function listProfileConfigs(): Promise<string[]> {
  const entries = await fs.readdir(CODEX_HOME).catch(() => [] as string[]);
  return entries
    .filter((name) => name.endsWith(".config.toml") && name !== "config.toml")
    .map((name) => path.join(CODEX_HOME, name));
}

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  roots: { home: CODEX_HOME, configFiles: [CODEX_CONFIG] },
  async listConfigFiles() {
    const profiles = await listProfileConfigs();
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
      ...profiles.map((p) => ({
        id: `codex-profile:${path.basename(p)}`,
        provider: "codex" as const,
        label: path.basename(p),
        path: p,
        format: "toml" as const,
        scope: "user" as const,
        writable: true,
      })),
    ];
  },
  async readMcpServers() {
    const raw = await fs.readFile(CODEX_CONFIG, "utf8").catch(() => "");
    return raw ? readCodexMcpServersFromToml(raw) : [];
  },
  async listCatalog() {
    const items = [];
    const globalAgents = path.join(CODEX_HOME, "AGENTS.md");
    const globalOverride = path.join(CODEX_HOME, "AGENTS.override.md");
    for (const p of [globalAgents, globalOverride]) {
      const stat = await fs.stat(p).catch(() => null);
      if (!stat) continue;
      items.push({
        name: path.basename(p),
        kind: "command" as const,
        description: "Codex instruction file",
        path: p,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    const memories = path.join(CODEX_HOME, "memories");
    for (const name of ["memory_summary.md", "MEMORY.md"]) {
      const p = path.join(memories, name);
      const stat = await fs.stat(p).catch(() => null);
      if (!stat) continue;
      items.push({
        name,
        kind: "skill" as const,
        description: "Codex memory file",
        path: p,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    return items;
  },
  async listProjects() {
    const files = [CODEX_CONFIG, ...(await codexMemoryFiles())];
    const mtimes = (
      await Promise.all(files.map(async (p) => (await statOrNull(p))?.mtimeMs ?? 0))
    ).filter((n) => n > 0);
    return [
      {
        id: "codex:local",
        provider: "codex" as const,
        localId: "local",
        title: "Codex Local Context",
        realPath: null,
        latestActivityAt: mtimes.length ? iso(Math.max(...mtimes)) : null,
      },
    ];
  },
  async listSessions() {
    const files = await codexMemoryFiles();
    const out = [];
    for (const file of files) {
      const stat = await statOrNull(file);
      if (!stat) continue;
      out.push({
        id: `codex:${path.basename(file, path.extname(file))}` as const,
        provider: "codex" as const,
        projectId: "codex:local" as const,
        title: path.basename(file),
        updatedAt: iso(stat.mtimeMs),
        sourcePath: file,
      });
    }
    return out;
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
