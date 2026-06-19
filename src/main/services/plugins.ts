import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOME } from "../config.js";

interface InstalledEntry {
  scope: string;
  projectPath?: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated?: string;
}

export async function getPlugins() {
  const pluginsDir = path.join(CLAUDE_HOME, "plugins");

  const installed = JSON.parse(
    await fs.readFile(path.join(pluginsDir, "installed_plugins.json"), "utf8").catch(() => '{"plugins":{}}'),
  ) as { plugins: Record<string, InstalledEntry[]> };

  const blocklist = JSON.parse(
    await fs.readFile(path.join(pluginsDir, "blocklist.json"), "utf8").catch(() => '{"plugins":[]}'),
  ) as { plugins: { plugin: string; reason: string }[] };

  const settings = JSON.parse(
    await fs.readFile(path.join(CLAUDE_HOME, "settings.json"), "utf8"),
  ) as { enabledPlugins?: Record<string, boolean> };

  const enabled = settings.enabledPlugins ?? {};

  const ids = new Set([...Object.keys(installed.plugins), ...Object.keys(enabled)]);
  const result = [...ids].map((id) => {
    const installs = installed.plugins[id] ?? [];
    return {
      id,
      enabledInSettings: enabled[id] ?? null,
      installs: installs.map((i) => ({
        scope: i.scope,
        projectPath: i.projectPath,
        version: i.version,
        installedAt: i.installedAt,
        lastUpdated: i.lastUpdated,
      })),
      blocked: blocklist.plugins.some((b) => b.plugin === id),
    };
  });

  return { plugins: result, blocklist: blocklist.plugins };
}
