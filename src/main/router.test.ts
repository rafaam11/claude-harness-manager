import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedConfigFile } from "@shared/provider-types";

const {
  getProvidersMock,
  claudeProvider,
  codexProvider,
  safeWriteMock,
  getUsageSummariesMock,
  setupClaudeUsageCaptureMock,
  disableClaudeUsageCaptureMock,
} = vi.hoisted(() => {
  const makeProvider = (id: "claude" | "codex", catalogName: string, mcpName: string) => {
    return {
      id,
      label: id,
      roots: { home: `/tmp/${id}`, configFiles: [] as string[] },
      listConfigFiles: vi.fn(async (): Promise<NormalizedConfigFile[]> => []),
      readMcpServers: vi.fn(async () => [{ name: mcpName }]),
      listCatalog: vi.fn(async () => [{ name: catalogName }]),
      listProjects: vi.fn(async () => []),
      listSessions: vi.fn(async () => []),
      listPlans: vi.fn(async () => []),
      detectRunning: vi.fn(async () => false),
    };
  };

  const claudeProvider = makeProvider("claude", "claude-catalog", "claude-mcp");
  const codexProvider = makeProvider("codex", "codex-catalog", "codex-mcp");
  const getProvidersMock = vi.fn((filter: "claude" | "codex" | "all") => {
    if (filter === "claude") return [claudeProvider];
    if (filter === "codex") return [codexProvider];
    return [claudeProvider, codexProvider];
  });

  const safeWriteMock = vi.fn(async () => ({ ok: true }));
  const getUsageSummariesMock = vi.fn(async (filter: "claude" | "codex" | "all") => [
    { provider: filter },
  ]);
  const setupClaudeUsageCaptureMock = vi.fn(async () => ({ provider: "claude", enabled: true }));
  const disableClaudeUsageCaptureMock = vi.fn(async () => ({ provider: "claude", enabled: false }));

  return {
    getProvidersMock,
    claudeProvider,
    codexProvider,
    safeWriteMock,
    getUsageSummariesMock,
    setupClaudeUsageCaptureMock,
    disableClaudeUsageCaptureMock,
  };
});

vi.mock("./providers/registry.js", async () => {
  const actual = await vi.importActual<typeof import("./providers/registry.js")>(
    "./providers/registry.js",
  );
  return {
    ...actual,
    getProviders: getProvidersMock,
  };
});

vi.mock("./lib/safe-write.js", async () => {
  const actual = await vi.importActual<typeof import("./lib/safe-write.js")>(
    "./lib/safe-write.js",
  );
  return {
    ...actual,
    safeWrite: safeWriteMock,
  };
});

vi.mock("./services/usage.js", () => ({
  getUsageSummaries: getUsageSummariesMock,
  setupClaudeUsageCapture: setupClaudeUsageCaptureMock,
  disableClaudeUsageCapture: disableClaudeUsageCaptureMock,
}));

import { HttpError, routeRequest } from "./router.js";

beforeEach(() => {
  getProvidersMock.mockClear();
  claudeProvider.listCatalog.mockClear();
  claudeProvider.readMcpServers.mockClear();
  codexProvider.listCatalog.mockClear();
  codexProvider.readMcpServers.mockClear();
  claudeProvider.listConfigFiles.mockReset();
  codexProvider.listConfigFiles.mockReset();
  claudeProvider.listConfigFiles.mockResolvedValue([]);
  codexProvider.listConfigFiles.mockResolvedValue([]);
  safeWriteMock.mockClear();
  getUsageSummariesMock.mockClear();
  setupClaudeUsageCaptureMock.mockClear();
  disableClaudeUsageCaptureMock.mockClear();
});

describe("provider-aware catalog and MCP routes", () => {
  it("defaults missing provider query to claude for /api/catalog and /api/mcp", async () => {
    await expect(routeRequest({ method: "GET", url: "app://local/api/catalog" } as never)).resolves.toEqual([
      { name: "claude-catalog", provider: "claude" },
    ]);
    expect(getProvidersMock).toHaveBeenNthCalledWith(1, "claude");

    await expect(routeRequest({ method: "GET", url: "app://local/api/mcp" } as never)).resolves.toEqual([
      { name: "claude-mcp", provider: "claude" },
    ]);
    expect(getProvidersMock).toHaveBeenNthCalledWith(2, "claude");
  });

  it.each([
    ["/api/catalog", "provider="],
    ["/api/catalog", "provider=bogus"],
    ["/api/mcp", "provider="],
    ["/api/mcp", "provider=bogus"],
  ])("rejects %s with %s", async (pathname, search) => {
    const error = await routeRequest({
      method: "GET",
      url: `app://local${pathname}?${search}`,
    } as never).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 400, message: "invalid provider filter" });
  });

  it.each([
    ["/api/catalog", "provider=codex", [{ name: "codex-catalog", provider: "codex" }]],
    [
      "/api/catalog",
      "provider=all",
      [
        { name: "claude-catalog", provider: "claude" },
        { name: "codex-catalog", provider: "codex" },
      ],
    ],
    ["/api/mcp", "provider=codex", [{ name: "codex-mcp", provider: "codex" }]],
    [
      "/api/mcp",
      "provider=all",
      [
        { name: "claude-mcp", provider: "claude" },
        { name: "codex-mcp", provider: "codex" },
      ],
    ],
  ])("accepts %s with %s", async (pathname, search, expected) => {
    await expect(
      routeRequest({
        method: "GET",
        url: `app://local${pathname}?${search}`,
      } as never),
    ).resolves.toEqual(expected);
  });
});

describe("provider config writes", () => {
  it("rejects Codex profile config writes even if a descriptor is mistakenly writable", async () => {
    codexProvider.listConfigFiles.mockResolvedValue([
      {
        id: "codex-profile:work.config.toml",
        provider: "codex",
        label: "work.config.toml",
        path: "/tmp/codex/work.config.toml",
        format: "toml",
        scope: "user",
        writable: true,
      },
    ]);

    const error = await routeRequest({
      method: "PUT",
      url: "app://local/api/config/file/codex-profile%3Awork.config.toml",
      body: { content: "model = \"x\"\n", baseHash: "abc" },
    } as never).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 403 });
    expect(safeWriteMock).not.toHaveBeenCalled();
  });
});

describe("usage routes", () => {
  it("passes provider filter to usage service and rejects invalid filters", async () => {
    await expect(
      routeRequest({ method: "GET", url: "app://local/api/usage?provider=codex" } as never),
    ).resolves.toEqual([{ provider: "codex" }]);
    expect(getUsageSummariesMock).toHaveBeenCalledWith("codex");

    const error = await routeRequest({
      method: "GET",
      url: "app://local/api/usage?provider=bogus",
    } as never).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 400, message: "invalid provider filter" });
  });

  it("routes Claude capture setup and disable actions", async () => {
    await expect(
      routeRequest({ method: "POST", url: "app://local/api/usage/claude-capture/setup" } as never),
    ).resolves.toMatchObject({ enabled: true });
    await expect(
      routeRequest({ method: "POST", url: "app://local/api/usage/claude-capture/disable" } as never),
    ).resolves.toMatchObject({ enabled: false });
    expect(setupClaudeUsageCaptureMock).toHaveBeenCalledTimes(1);
    expect(disableClaudeUsageCaptureMock).toHaveBeenCalledTimes(1);
  });
});
