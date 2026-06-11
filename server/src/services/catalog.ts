import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { CLAUDE_HOME, AGENT_SIZE_WARN_BYTES } from "../config.js";

export interface CatalogItem {
  name: string;
  kind: "skill" | "agent" | "command";
  description: string;
  path: string;
  size: number;
  mtime: number;
  warn?: string;
}

async function readFrontmatterDescription(p: string): Promise<string> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const fm = matter(raw);
    return (fm.data?.description as string) ?? "";
  } catch {
    return "";
  }
}

export async function getCatalog(): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];

  // 개인 스킬: skills\<name>\SKILL.md
  const skillsDir = path.join(CLAUDE_HOME, "skills");
  for (const entry of await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, "SKILL.md");
    const stat = await fs.stat(skillMd).catch(() => null);
    if (!stat) continue;
    items.push({
      name: entry.name,
      kind: "skill",
      description: await readFrontmatterDescription(skillMd),
      path: skillMd,
      size: stat.size,
      mtime: stat.mtimeMs,
    });
  }

  // 커스텀 에이전트: agents\*.md
  const agentsDir = path.join(CLAUDE_HOME, "agents");
  for (const entry of await fs.readdir(agentsDir).catch(() => [])) {
    if (!entry.endsWith(".md")) continue;
    const p = path.join(agentsDir, entry);
    const stat = await fs.stat(p);
    items.push({
      name: entry.replace(/\.md$/, ""),
      kind: "agent",
      description: await readFrontmatterDescription(p),
      path: p,
      size: stat.size,
      mtime: stat.mtimeMs,
      warn: stat.size > AGENT_SIZE_WARN_BYTES ? `19KB 초과 (${(stat.size / 1024).toFixed(1)}KB)` : undefined,
    });
  }

  // slash command: commands\**\*.md
  const commandsDir = path.join(CLAUDE_HOME, "commands");
  async function walkCommands(dir: string, prefix: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkCommands(p, prefix ? `${prefix}:${entry.name}` : entry.name);
      } else if (entry.name.endsWith(".md")) {
        const stat = await fs.stat(p);
        const cmdName = entry.name.replace(/\.md$/, "");
        items.push({
          name: prefix ? `${prefix}:${cmdName}` : cmdName,
          kind: "command",
          description: await readFrontmatterDescription(p),
          path: p,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      }
    }
  }
  await walkCommands(commandsDir, "");

  return items;
}
