import fs from "node:fs/promises";
import { CLAUDE_JSON } from "../config.js";

export interface McpServer {
  name: string;
  scope: "user" | "project";
  projectPath?: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function toServer(
  name: string,
  def: Record<string, unknown>,
  scope: "user" | "project",
  projectPath?: string,
): McpServer {
  const type = def.type as string | undefined;
  let transport: McpServer["transport"] = "unknown";
  if (type === "stdio" || type === "http" || type === "sse") transport = type;
  else if (def.command) transport = "stdio";
  else if (def.url) transport = "http";
  return {
    name,
    scope,
    projectPath,
    transport,
    command: def.command as string | undefined,
    args: Array.isArray(def.args) ? (def.args as string[]) : undefined,
    env: (def.env as Record<string, string> | undefined) ?? undefined,
    url: def.url as string | undefined,
    headers: (def.headers as Record<string, string> | undefined) ?? undefined,
  };
}

/** ~/.claude.json은 읽기만 한다(읽기 전용 정책 불변). */
export async function getMcpServers(): Promise<McpServer[]> {
  const raw = await fs.readFile(CLAUDE_JSON, "utf8").catch(() => null);
  if (!raw) return [];
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: McpServer[] = [];

  const top = json.mcpServers as Record<string, Record<string, unknown>> | undefined;
  for (const [name, def] of Object.entries(top ?? {})) {
    out.push(toServer(name, def, "user"));
  }

  const projects = json.projects as
    | Record<string, { mcpServers?: Record<string, Record<string, unknown>> }>
    | undefined;
  for (const [projectPath, pdata] of Object.entries(projects ?? {})) {
    for (const [name, def] of Object.entries(pdata.mcpServers ?? {})) {
      out.push(toServer(name, def, "project", projectPath));
    }
  }
  return out;
}
