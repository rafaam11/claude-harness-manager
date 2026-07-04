import { describe, expect, it } from "vitest";
import { readCodexMcpServersFromToml, validateTomlConfig } from "./toml-validate.js";

describe("toml validation", () => {
  it("accepts valid Codex config TOML", () => {
    expect(() =>
      validateTomlConfig("codex-config", 'model = "gpt-5.5"\n[mcp_servers.context7]\ncommand = "npx"\n'),
    ).not.toThrow();
  });

  it("rejects invalid TOML", () => {
    expect(() => validateTomlConfig("codex-config", "model = ")).toThrow(/invalid TOML/);
  });

  it("extracts Codex MCP servers", () => {
    const servers = readCodexMcpServersFromToml(`
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
env = { TOKEN = "x" }

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_TOKEN"
`);
    expect(servers).toMatchObject([
      { name: "context7", scope: "user", transport: "stdio", command: "npx" },
      { name: "figma", scope: "user", transport: "http", url: "https://mcp.figma.com/mcp" },
    ]);
  });
});
