import { load } from "js-toml";
import type { McpServer } from "../services/mcp.js";

export class TomlValidationError extends Error {
  statusCode = 422;
}

export function parseToml(content: string): Record<string, unknown> {
  try {
    const parsed = load(content);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (e) {
    throw new TomlValidationError(`invalid TOML: ${(e as Error).message}`);
  }
}

export function validateTomlConfig(_name: string, content: string): void {
  parseToml(content);
}

export function readCodexMcpServersFromToml(content: string): McpServer[] {
  const parsed = parseToml(content);
  const servers = parsed.mcp_servers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers as Record<string, Record<string, unknown>>).map(([name, def]) => {
    const hasCommand = typeof def.command === "string";
    const hasUrl = typeof def.url === "string";
    return {
      name,
      scope: "user",
      transport: hasCommand ? "stdio" : hasUrl ? "http" : "unknown",
      command: hasCommand ? (def.command as string) : undefined,
      args: Array.isArray(def.args) ? (def.args as string[]) : undefined,
      env: def.env && typeof def.env === "object" ? (def.env as Record<string, string>) : undefined,
      url: hasUrl ? (def.url as string) : undefined,
      headers:
        def.http_headers && typeof def.http_headers === "object"
          ? (def.http_headers as Record<string, string>)
          : undefined,
    };
  });
}
