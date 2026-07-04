# Harness Manager v2 Provider Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Harness Manager from a Claude Code-only local manager into a provider-neutral app that preserves Claude Code behavior and adds safe Codex local support.

**Architecture:** Keep the current Electron IPC router and shared safety primitives, but move provider-specific filesystem knowledge behind `claude` and `codex` adapters. Renderer pages consume normalized provider-aware models instead of Claude-only project/session/config shapes.

**Tech Stack:** Electron 34, electron-vite 3, TypeScript 5.7, React 18, Node >=20.0.0, Vitest for pure-module tests, `js-toml` for validating Codex TOML config text.

## Global Constraints

- Preserve existing Claude Code features and data.
- User-visible app name is `Harness Manager`.
- Keep `appId` as `com.digitrack.claudeharnessmanager` for v2 unless a separate updater migration proves it is safe to change.
- Do not edit project `.codex/config.toml`, `AGENTS.md`, Codex memories, or Codex session/log files in v2.0.0.
- Allow Codex writes only for app-owned state and user-level `~/.codex/config.toml` after TOML validation.
- Use ESM relative imports with `.js` extensions in `src/main`, `src/preload`, and `src/shared`.
- Do not bypass `withLock`, safe-write backups, archive-not-delete behavior, or git repo guards.
- Required verification for implementation tasks: `npm run test`, `npm run typecheck`, and `npm run build` unless a task explicitly states a narrower check before commit.

---

## File Structure

| Path | Responsibility | Change |
|---|---|---|
| `package.json` | scripts, test/dev dependencies, release metadata | modify |
| `vitest.config.ts` | Vitest config for main/shared pure tests | create |
| `src/main/lib/path-scope.ts` | narrow subtree/category/path-segment guards | create |
| `src/main/lib/path-scope.test.ts` | guard tests | create |
| `src/main/lib/archive.ts` | enforce cleanup category and archive-root containment | modify |
| `src/main/services/projects.ts` | enforce project subtree file browsing | modify |
| `src/main/lib/safe-write.ts` | constrain backup names and backup root access | modify |
| `src/shared/provider-types.ts` | provider IDs and normalized renderer-facing models | create |
| `src/shared/types.ts` | re-export provider types | modify |
| `src/main/providers/types.ts` | main provider adapter interface | create |
| `src/main/providers/registry.ts` | provider registry and selection helpers | create |
| `src/main/providers/claude.ts` | Claude adapter wrapping existing services | create |
| `src/main/providers/codex.ts` | Codex adapter for read-only surfaces and status | create |
| `src/main/lib/toml-validate.ts` | TOML validation wrapper using `js-toml` | create |
| `src/main/lib/board.ts` | schema v2 board data and migration | modify |
| `src/main/services/recall.ts` | provider-aware normalized workspace/timeline output | modify |
| `src/main/services/git/index.ts` | resolve provider-prefixed project IDs | modify |
| `src/main/router.ts` | provider routes and compatibility wrappers | modify |
| `src/renderer/src/pages/workspace-shared.ts` | consume shared provider types and helpers | modify |
| `src/renderer/src/App.tsx` | provider status and filter state | modify |
| `src/renderer/src/pages/Workspace.tsx` | provider badges/filter and normalized IDs | modify |
| `src/renderer/src/pages/Timeline.tsx` | provider-aware event display | modify |
| `src/renderer/src/pages/Catalog.tsx` | provider capability grouping | modify |
| `src/renderer/src/pages/ConfigEditor.tsx` | JSON/TOML/Markdown file-oriented config UI | modify |
| `src/renderer/src/index.css` | provider badges and TOML/config status styles | modify |
| `.github/workflows/release.yml` | verify release asset behavior | modify only if matrix/manifests need adjustment |

---

### Task 1: Test Harness for Pure Main/Shared Modules

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/main/lib/path-scope.test.ts`

**Interfaces:**
- Produces: `npm run test` as the standard unit test command.
- Produces: test environment aliases for `@shared/*`.

- [ ] **Step 1: Install Vitest**

Run:

```bash
npm install -D vitest
```

Expected: `package.json` and `package-lock.json` include `vitest`.

- [ ] **Step 2: Add the test script**

In `package.json`, add `test` next to the existing scripts:

```json
"scripts": {
  "dev": "electron-vite dev",
  "test": "vitest run",
  "typecheck": "tsc --noEmit -p tsconfig.node.json --composite false && tsc --noEmit -p tsconfig.web.json --composite false",
  "build": "npm run typecheck && electron-vite build",
  "start": "electron-vite preview",
  "icon": "node scripts/generate-icon.mjs",
  "dist": "npm run build && electron-builder --win --publish never",
  "dist:linux": "npm run build && electron-builder --linux --publish never"
}
```

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
```

- [ ] **Step 4: Add a smoke test**

Create `src/main/lib/path-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs node-side TypeScript tests", () => {
    expect(pathSepExample("a", "b")).toBe("a/b");
  });
});

function pathSepExample(left: string, right: string): string {
  return `${left}/${right}`;
}
```

- [ ] **Step 5: Run the new test command**

Run:

```bash
npm run test
```

Expected: PASS for `src/main/lib/path-scope.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/main/lib/path-scope.test.ts
git commit -m "test: add vitest harness"
```

---

### Task 2: Narrow Path and Category Guards

**Files:**
- Create: `src/main/lib/path-scope.ts`
- Modify: `src/main/lib/path-scope.test.ts`
- Modify: `src/main/lib/archive.ts`
- Modify: `src/main/services/projects.ts`
- Modify: `src/main/lib/safe-write.ts`
- Modify: `src/main/router.ts`

**Interfaces:**
- Produces: `assertInsideRoot(candidate, root, label): string`
- Produces: `assertSafePathSegment(value, label): string`
- Produces: `assertSafeRelativePath(value, label): string`
- Produces: `assertCleanupCategory(value): CleanupArchiveCategory`

- [ ] **Step 1: Replace the smoke test with failing guard tests**

Replace `src/main/lib/path-scope.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCleanupCategory,
  assertInsideRoot,
  assertSafePathSegment,
  assertSafeRelativePath,
} from "./path-scope.js";

describe("path scope guards", () => {
  it("allows a child inside the intended root", () => {
    const root = path.resolve("root");
    const child = path.join(root, "a", "b.txt");
    expect(assertInsideRoot(child, root, "project")).toBe(path.resolve(child));
  });

  it("rejects a sibling with the same prefix", () => {
    const root = path.resolve("root");
    const sibling = path.resolve("root-evil", "x.txt");
    expect(() => assertInsideRoot(sibling, root, "project")).toThrow(/project/);
  });

  it("rejects unsafe path segments", () => {
    expect(() => assertSafePathSegment("../x", "project id")).toThrow(/project id/);
    expect(() => assertSafePathSegment("a/b", "project id")).toThrow(/project id/);
    expect(assertSafePathSegment("D--repo-name", "project id")).toBe("D--repo-name");
  });

  it("rejects relative paths that escape their root", () => {
    expect(() => assertSafeRelativePath("../settings.json", "project file")).toThrow(
      /project file/,
    );
    expect(assertSafeRelativePath("memory/session.jsonl", "project file")).toBe(
      "memory/session.jsonl",
    );
  });

  it("allows only cleanup categories produced by scanCandidates", () => {
    expect(assertCleanupCategory("projects")).toBe("projects");
    expect(assertCleanupCategory("temp/session-env")).toBe("temp/session-env");
    expect(() => assertCleanupCategory("../../escape")).toThrow(/cleanup category/);
    expect(() => assertCleanupCategory("warn-only")).toThrow(/cleanup category/);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test -- src/main/lib/path-scope.test.ts
```

Expected: FAIL because `src/main/lib/path-scope.ts` does not exist.

- [ ] **Step 3: Add guard implementation**

Create `src/main/lib/path-scope.ts`:

```ts
import path from "node:path";
import { TEMP_DIRS } from "../config.js";

export class PathScopeError extends Error {
  statusCode = 403;
}

export type CleanupArchiveCategory = "projects" | `temp/${string}`;

function fail(label: string, value: string): never {
  throw new PathScopeError(`${label} is outside allowed scope: ${value}`);
}

export function assertInsideRoot(candidate: string, root: string, label: string): string {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)) return resolved;
  return fail(label, resolved);
}

export function assertSafePathSegment(value: string, label: string): string {
  if (!value || value === "." || value === "..") return fail(label, value);
  if (path.isAbsolute(value)) return fail(label, value);
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    return fail(label, value);
  }
  return value;
}

export function assertSafeRelativePath(value: string, label: string): string {
  if (!value || path.isAbsolute(value)) return fail(label, value);
  const normalized = path.normalize(value);
  if (normalized === "." || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    return fail(label, value);
  }
  return normalized;
}

export function assertCleanupCategory(value: string): CleanupArchiveCategory {
  if (value === "projects") return value;
  for (const dir of TEMP_DIRS) {
    const allowed = `temp/${dir}`;
    if (value === allowed) return allowed;
  }
  return fail("cleanup category", value);
}
```

- [ ] **Step 4: Apply guards to archive**

In `src/main/lib/archive.ts`, add imports:

```ts
import {
  assertCleanupCategory,
  assertInsideRoot,
  type CleanupArchiveCategory,
} from "./path-scope.js";
```

Change `archiveItems` signature and destination setup:

```ts
export async function archiveItems(
  items: { path: string; reason: string }[],
  category: string,
): Promise<ManifestEntry[]> {
  return withLock(async () => {
    const safeCategory: CleanupArchiveCategory = assertCleanupCategory(category);
    const base = guardPath(archiveDir());
    const destDir = assertInsideRoot(path.join(base, safeCategory), base, "archive category");
    await fs.mkdir(destDir, { recursive: true });
```

Keep the rest of the function body unchanged.

- [ ] **Step 5: Apply guards to project file browsing**

In `src/main/services/projects.ts`, add:

```ts
import { assertInsideRoot, assertSafePathSegment, assertSafeRelativePath } from "../lib/path-scope.js";
```

Change `listProjectFiles` root setup:

```ts
export async function listProjectFiles(id: string) {
  const safeId = assertSafePathSegment(id, "project id");
  const projectsRoot = guardPath(path.join(CLAUDE_HOME, "projects"));
  const dir = assertInsideRoot(path.join(projectsRoot, safeId), projectsRoot, "project root");
```

Change `readProjectFile` path setup:

```ts
export async function readProjectFile(id: string, relPath: string) {
  const safeId = assertSafePathSegment(id, "project id");
  const safeRel = assertSafeRelativePath(relPath, "project file");
  const projectsRoot = guardPath(path.join(CLAUDE_HOME, "projects"));
  const projectRoot = assertInsideRoot(path.join(projectsRoot, safeId), projectsRoot, "project root");
  const p = assertInsideRoot(path.join(projectRoot, safeRel), projectRoot, "project file");
```

Keep the existing size/truncation logic after `const stat = await fs.stat(p);`.

- [ ] **Step 6: Apply guards to backup names**

In `src/main/lib/safe-write.ts`, add:

```ts
import { assertInsideRoot, assertSafePathSegment } from "./path-scope.js";
```

Change `listBackups`:

```ts
export async function listBackups(fileBase: string) {
  const safeBase = assertSafePathSegment(fileBase, "backup base");
  const entries = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const mine = entries.filter((e) => e.startsWith(safeBase + ".")).sort().reverse();
```

Change `restoreBackup` backup path:

```ts
const safeBackupName = assertSafePathSegment(backupName, "backup name");
const backupRoot = guardPath(BACKUP_DIR);
const backupPath = assertInsideRoot(path.join(backupRoot, safeBackupName), backupRoot, "backup");
```

- [ ] **Step 7: Validate cleanup categories before dry-run response**

In `src/main/router.ts`, add `assertCleanupCategory` import:

```ts
import { assertCleanupCategory } from "./lib/path-scope.js";
```

Inside `/api/cleanup/execute`, before the warn-only check, add:

```ts
for (const item of items) assertCleanupCategory(item.category);
```

- [ ] **Step 8: Run verification**

Run:

```bash
npm run test -- src/main/lib/path-scope.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/main/lib/path-scope.ts src/main/lib/path-scope.test.ts src/main/lib/archive.ts src/main/services/projects.ts src/main/lib/safe-write.ts src/main/router.ts
git commit -m "fix: narrow filesystem scope guards"
```

---

### Task 3: Shared Provider Types and Registry Skeleton

**Files:**
- Create: `src/shared/provider-types.ts`
- Modify: `src/shared/types.ts`
- Create: `src/main/providers/types.ts`
- Create: `src/main/providers/registry.ts`
- Create: `src/main/providers/claude.ts`
- Create: `src/main/providers/codex.ts`
- Create: `src/main/providers/registry.test.ts`

**Interfaces:**
- Produces: `ProviderId`, `EntityId`, `ProviderStatus`, `NormalizedConfigFile`
- Produces: `getProvider(id)`, `getProviders(filter)`, `prefixEntityId(provider, id)`

- [ ] **Step 1: Write failing registry tests**

Create `src/main/providers/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getProvider, getProviders, prefixEntityId, splitEntityId } from "./registry.js";

describe("provider registry", () => {
  it("returns registered providers", () => {
    expect(getProvider("claude").id).toBe("claude");
    expect(getProvider("codex").id).toBe("codex");
    expect(getProviders("all").map((p) => p.id)).toEqual(["claude", "codex"]);
  });

  it("prefixes and splits entity ids", () => {
    expect(prefixEntityId("codex", "abc")).toBe("codex:abc");
    expect(splitEntityId("claude:D--repo")).toEqual({ provider: "claude", localId: "D--repo" });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run test -- src/main/providers/registry.test.ts
```

Expected: FAIL because provider files do not exist.

- [ ] **Step 3: Add shared provider types**

Create `src/shared/provider-types.ts`:

```ts
export type ProviderId = "claude" | "codex";
export type ProviderFilter = ProviderId | "all";
export type EntityId = `${ProviderId}:${string}`;

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  running: boolean;
  roots: string[];
}

export interface NormalizedConfigFile {
  id: string;
  provider: ProviderId;
  label: string;
  path: string;
  format: "json" | "toml" | "markdown";
  scope: "user" | "project" | "app";
  writable: boolean;
}

export interface NormalizedSession {
  id: EntityId;
  provider: ProviderId;
  projectId?: EntityId;
  title?: string;
  cwd?: string;
  model?: string;
  startedAt?: string;
  updatedAt: string;
  lastUserText?: string;
  lastAssistantText?: string;
  sourcePath?: string;
}

export interface NormalizedProject {
  id: EntityId;
  provider: ProviderId;
  localId: string;
  title: string;
  realPath: string | null;
  latestActivityAt: string | null;
}

export interface NormalizedPlan {
  id: EntityId;
  provider: ProviderId;
  title: string;
  sourcePath: string;
  updatedAt: string;
  archived: boolean;
  projectId: EntityId | null;
}
```

In `src/shared/types.ts`, add:

```ts
export * from "./provider-types.js";
```

- [ ] **Step 4: Add main provider interface**

Create `src/main/providers/types.ts`:

```ts
import type {
  NormalizedConfigFile,
  NormalizedPlan,
  NormalizedProject,
  NormalizedSession,
  ProviderId,
} from "@shared/provider-types";
import type { CatalogItem } from "../services/catalog.js";
import type { McpServer } from "../services/mcp.js";

export interface ProviderRoots {
  home: string;
  configFiles: string[];
  appData?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  roots: ProviderRoots;
  listConfigFiles(): Promise<NormalizedConfigFile[]>;
  readMcpServers(): Promise<McpServer[]>;
  listCatalog(): Promise<CatalogItem[]>;
  listProjects(): Promise<NormalizedProject[]>;
  listSessions(): Promise<NormalizedSession[]>;
  listPlans(): Promise<NormalizedPlan[]>;
  detectRunning(): Promise<boolean>;
}
```

- [ ] **Step 5: Add Claude and Codex provider skeletons**

Create `src/main/providers/claude.ts`:

```ts
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
      format: "json",
      scope: id === "claude-json" ? "user" : "user",
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
```

Create `src/main/providers/codex.ts`:

```ts
import os from "node:os";
import path from "node:path";
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
    return false;
  },
};
```

- [ ] **Step 6: Add registry**

Create `src/main/providers/registry.ts`:

```ts
import type { EntityId, ProviderFilter, ProviderId } from "@shared/provider-types";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import type { ProviderAdapter } from "./types.js";

const providers: Record<ProviderId, ProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
};

export function getProvider(id: ProviderId): ProviderAdapter {
  return providers[id];
}

export function getProviders(filter: ProviderFilter = "all"): ProviderAdapter[] {
  if (filter === "all") return [providers.claude, providers.codex];
  return [providers[filter]];
}

export function prefixEntityId(provider: ProviderId, localId: string): EntityId {
  return `${provider}:${localId}`;
}

export function splitEntityId(id: string): { provider: ProviderId; localId: string } {
  const idx = id.indexOf(":");
  const provider = id.slice(0, idx);
  const localId = id.slice(idx + 1);
  if ((provider === "claude" || provider === "codex") && localId) {
    return { provider, localId };
  }
  return { provider: "claude", localId: id };
}
```

- [ ] **Step 7: Run verification**

Run:

```bash
npm run test -- src/main/providers/registry.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/provider-types.ts src/shared/types.ts src/main/providers src/main/providers/registry.test.ts
git commit -m "feat: add provider registry skeleton"
```

---

### Task 4: Provider Status and Config File APIs

**Files:**
- Modify: `src/main/router.ts`
- Modify: `src/main/lib/path-guard.ts`
- Modify: `src/main/providers/codex.ts`
- Create: `src/main/lib/process-detect.ts`
- Modify: `src/main/lib/cc-detect.ts`

**Interfaces:**
- Produces: `GET /api/provider/status`
- Produces: `GET /api/config/files?provider=claude|codex|all`
- Preserves: `GET /api/cc-status`

- [ ] **Step 1: Add generic process detection**

Create `src/main/lib/process-detect.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function detectProcess(names: string[]): Promise<boolean> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("tasklist", []).catch(() => ({ stdout: "" }));
    const lower = stdout.toLowerCase();
    return names.some((name) => lower.includes(name.toLowerCase()));
  }
  for (const name of names) {
    const result = await execFileAsync("pgrep", ["-x", name]).catch(() => null);
    if (result) return true;
  }
  return false;
}
```

Change `src/main/lib/cc-detect.ts` to use it while preserving the existing `/api/cc-status` response shape:

```ts
import { detectProcess } from "./process-detect.js";

export async function detectClaude(): Promise<{ running: boolean; pids: number[] }> {
  const running = await detectProcess(
    process.platform === "win32" ? ["Claude.exe", "claude.exe"] : ["Claude", "claude"],
  );
  return { running, pids: [] };
}
```

- [ ] **Step 2: Add Codex process detection**

In `src/main/providers/codex.ts`, import `detectProcess`:

```ts
import { detectProcess } from "../lib/process-detect.js";
```

Replace `detectRunning`:

```ts
async detectRunning() {
  return detectProcess(process.platform === "win32" ? ["Codex.exe", "codex.exe"] : ["Codex", "codex"]);
},
```

- [ ] **Step 3: Make path guard roots provider-aware**

In `src/main/lib/path-guard.ts`, replace the import and root lookup:

```ts
import path from "node:path";
import { ALLOWED_ROOTS } from "../config.js";
import { getProviders } from "../providers/registry.js";

function allowedRoots(): string[] {
  const providerRoots = getProviders("all").flatMap((p) => [
    p.roots.home,
    ...p.roots.configFiles,
    ...(p.roots.appData ? [p.roots.appData] : []),
  ]);
  return [...ALLOWED_ROOTS, ...providerRoots];
}
```

Then change `ALLOWED_ROOTS.some` to:

```ts
const ok = allowedRoots().some((root) => {
```

- [ ] **Step 4: Add provider routes**

In `src/main/router.ts`, import provider helpers:

```ts
import type { ProviderFilter } from "@shared/types";
import { getProviders } from "./providers/registry.js";
```

Add routes near `/api/cc-status`:

```ts
{
  method: "GET",
  pattern: "/api/provider/status",
  handler: async () => {
    const providers = getProviders("all");
    return Promise.all(
      providers.map(async (p) => ({
        id: p.id,
        label: p.label,
        running: await p.detectRunning(),
        roots: [p.roots.home, ...p.roots.configFiles],
      })),
    );
  },
},
{
  method: "GET",
  pattern: "/api/config/files",
  handler: async ({ query }) => {
    const provider = (query.provider ?? "all") as ProviderFilter;
    return (await Promise.all(getProviders(provider).map((p) => p.listConfigFiles()))).flat();
  },
},
```

- [ ] **Step 5: Run verification**

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/lib/process-detect.ts src/main/lib/cc-detect.ts src/main/lib/path-guard.ts src/main/providers/codex.ts src/main/router.ts
git commit -m "feat: expose provider status and config files"
```

---

### Task 5: Codex TOML Validation and Read-Only MCP Parsing

**Files:**
- Modify: `package.json`
- Create: `src/main/lib/toml-validate.ts`
- Create: `src/main/lib/toml-validate.test.ts`
- Modify: `src/main/providers/codex.ts`

**Interfaces:**
- Produces: `validateTomlConfig(name, content): void`
- Produces: Codex MCP servers from `[mcp_servers.<name>]`

- [ ] **Step 1: Install TOML parser**

Run:

```bash
npm install js-toml
```

Expected: `package.json` and `package-lock.json` include `js-toml`.

- [ ] **Step 2: Write failing TOML tests**

Create `src/main/lib/toml-validate.test.ts`:

```ts
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
```

- [ ] **Step 3: Add TOML validation implementation**

Create `src/main/lib/toml-validate.ts`:

```ts
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
      command: hasCommand ? def.command : undefined,
      args: Array.isArray(def.args) ? (def.args as string[]) : undefined,
      env: def.env && typeof def.env === "object" ? (def.env as Record<string, string>) : undefined,
      url: hasUrl ? def.url : undefined,
      headers:
        def.http_headers && typeof def.http_headers === "object"
          ? (def.http_headers as Record<string, string>)
          : undefined,
    };
  });
}
```

- [ ] **Step 4: Wire Codex MCP parsing**

In `src/main/providers/codex.ts`, add:

```ts
import fs from "node:fs/promises";
import { readCodexMcpServersFromToml } from "../lib/toml-validate.js";
```

Replace `readMcpServers`:

```ts
async readMcpServers() {
  const raw = await fs.readFile(CODEX_CONFIG, "utf8").catch(() => "");
  return raw ? readCodexMcpServersFromToml(raw) : [];
},
```

- [ ] **Step 5: Run verification**

Run:

```bash
npm run test -- src/main/lib/toml-validate.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/lib/toml-validate.ts src/main/lib/toml-validate.test.ts src/main/providers/codex.ts
git commit -m "feat: parse codex toml config"
```

---

### Task 6: Board Schema v2 Migration

**Files:**
- Modify: `src/main/config.ts`
- Modify: `src/main/lib/board.ts`
- Create: `src/main/lib/board.test.ts`

**Interfaces:**
- Produces: `BoardData` with `schemaVersion: 2`
- Produces: `migrateBoard(raw): BoardData`
- Preserves: `setPlanField`, `setProjectField`, `setSessionField`

- [ ] **Step 1: Add app-owned state constants**

In `src/main/config.ts`, define app state before `ALLOWED_ROOTS` and include it in the allowlist:

```ts
export const APP_STATE_DIR = path.join(os.homedir(), ".harness-manager");
export const ALLOWED_ROOTS = [CLAUDE_HOME, CLAUDE_JSON, APP_STATE_DIR];
```

Add these near the current board constants. Keep `BOARD_FILE` as the legacy Claude board path for migration.

```ts
export const APP_BACKUP_DIR = path.join(APP_STATE_DIR, "backups");
export const BOARD_FILE_V2 = path.join(APP_STATE_DIR, "board.json");
```

- [ ] **Step 2: Write failing board migration tests**

Create `src/main/lib/board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { migrateBoard } from "./board.js";

describe("board migration", () => {
  it("prefixes legacy keys with claude provider", () => {
    const migrated = migrateBoard({
      version: 1,
      projects: { "D--repo": { memo: "x" } },
      plans: { "plan.md": { status: "완료" } },
      sessions: { "session-1": { memo: "s" } },
    });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.projects["claude:D--repo"]?.memo).toBe("x");
    expect(migrated.plans["claude:plan.md"]?.status).toBe("완료");
    expect(migrated.sessions["claude:session-1"]?.memo).toBe("s");
  });

  it("keeps already-prefixed keys stable", () => {
    const migrated = migrateBoard({
      schemaVersion: 2,
      projects: { "codex:repo": { memo: "c" } },
      plans: {},
      sessions: {},
      migratedFrom: "legacy",
      migratedAt: "2026-07-04T00:00:00.000Z",
    });
    expect(migrated.projects["codex:repo"]?.memo).toBe("c");
  });
});
```

- [ ] **Step 3: Update board interfaces**

In `src/main/lib/board.ts`, change `BoardData`:

```ts
export interface BoardData {
  schemaVersion: 2;
  migratedFrom?: string;
  migratedAt?: string;
  plans: Record<string, PlanBoardEntry>;
  projects: Record<string, ProjectBoardEntry>;
  sessions: Record<string, SessionBoardEntry>;
}
```

Change `emptyBoard`:

```ts
function emptyBoard(): BoardData {
  return { schemaVersion: 2, plans: {}, projects: {}, sessions: {} };
}
```

- [ ] **Step 4: Add migration function**

Add this helper in `src/main/lib/board.ts` before `sanitize`:

```ts
function prefixLegacyKey(key: string): string {
  return key.startsWith("claude:") || key.startsWith("codex:") ? key : `claude:${key}`;
}

export function migrateBoard(parsed: unknown): BoardData {
  const sanitized = sanitize(parsed);
  const raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (raw.schemaVersion === 2) return sanitized;

  const migrated = emptyBoard();
  for (const [k, v] of Object.entries(sanitized.projects)) migrated.projects[prefixLegacyKey(k)] = v;
  for (const [k, v] of Object.entries(sanitized.plans)) migrated.plans[prefixLegacyKey(k)] = v;
  for (const [k, v] of Object.entries(sanitized.sessions)) migrated.sessions[prefixLegacyKey(k)] = v;
  migrated.migratedFrom = "legacy-claude-board";
  migrated.migratedAt = new Date().toISOString();
  return migrated;
}
```

Update `sanitize` so it returns schema v2 and preserves already-prefixed keys. Keep the existing field sanitization logic.

- [ ] **Step 5: Read v2 first, then legacy**

In `src/main/lib/board.ts`, import `BOARD_FILE_V2` and `APP_BACKUP_DIR`:

```ts
import { BOARD_FILE, BOARD_FILE_V2, APP_BACKUP_DIR, BACKUP_KEEP } from "../config.js";
```

Change `readBoard` to read `BOARD_FILE_V2` first and migrate legacy on first read:

```ts
export async function readBoard(): Promise<BoardData> {
  const p = guardPath(BOARD_FILE_V2);
  try {
    const raw = await fs.readFile(p, "utf8");
    return migrateBoard(JSON.parse(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const legacyPath = guardPath(BOARD_FILE);
  const legacyRaw = await fs.readFile(legacyPath, "utf8").catch(() => null);
  if (!legacyRaw) return emptyBoard();
  return migrateBoard(JSON.parse(legacyRaw));
}
```

Change `writeBoardAtomic` to use `BOARD_FILE_V2`.
Change board backup reads/writes from `BACKUP_DIR` to `APP_BACKUP_DIR` so app-owned board backups are not stored under the Claude home directory.

- [ ] **Step 6: Run verification**

Run:

```bash
npm run test -- src/main/lib/board.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/config.ts src/main/lib/board.ts src/main/lib/board.test.ts
git commit -m "feat: migrate board to provider-aware schema"
```

---

### Task 7: Normalize Claude Workspace IDs and Preserve Compatibility

**Files:**
- Modify: `src/main/services/recall.ts`
- Modify: `src/main/services/git/index.ts`
- Modify: `src/main/router.ts`
- Modify: `src/renderer/src/pages/workspace-shared.ts`
- Modify: `src/renderer/src/pages/Workspace.tsx`
- Modify: `src/renderer/src/pages/Timeline.tsx`

**Interfaces:**
- Consumes: `prefixEntityId`, `splitEntityId`
- Produces: provider-prefixed project/session IDs in Workspace and Timeline responses.
- Preserves: routes that receive old unprefixed Claude IDs.

- [ ] **Step 1: Add local compatibility helpers**

In `src/main/services/recall.ts`, import:

```ts
import { prefixEntityId, splitEntityId } from "../providers/registry.js";
```

Add helpers near the cache utilities:

```ts
function toClaudeId(localId: string): string {
  return prefixEntityId("claude", localId);
}

function fromMaybePrefixedClaudeId(id: string): string {
  const split = splitEntityId(id);
  return split.provider === "claude" ? split.localId : id;
}
```

- [ ] **Step 2: Prefix outgoing Workspace project IDs**

In `getWorkspaceProjects`, when returning each group, set:

```ts
const canonicalId = toClaudeId(g.canonicalId);
const memberIds = g.memberIds.map(toClaudeId);
```

Then return `id: canonicalId`, `memberIds`, and update `worktrees` members:

```ts
worktrees: g.worktrees.map((w) => ({ ...w, projectId: toClaudeId(w.projectId) })),
```

Keep board lookup using local Claude IDs until Task 6 migration is fully deployed; write routes should accept prefixed IDs and strip before legacy fallbacks.

- [ ] **Step 3: Accept prefixed IDs in project sessions**

At the start of `getProjectSessions`:

```ts
const localProjectId = fromMaybePrefixedClaudeId(projectId);
```

Use `localProjectId` for group matching and filesystem access.

- [ ] **Step 4: Prefix Timeline project and session IDs**

In `getTimeline`, when pushing session events, use:

```ts
projectId: toClaudeId(projectId),
sessionId: sid ? toClaudeId(sid) : undefined,
```

When pushing plan events, use:

```ts
projectId: p.projectId ? toClaudeId(p.projectId) : null,
parentSessionId: parentSessionId ? toClaudeId(parentSessionId) : undefined,
```

- [ ] **Step 5: Update Git facade ID parsing**

In `src/main/services/git/index.ts`, import `splitEntityId` and strip Claude IDs before existing recall lookup:

```ts
import { splitEntityId } from "../../providers/registry.js";

function localProjectId(projectId: string): string {
  const split = splitEntityId(projectId);
  return split.provider === "claude" ? split.localId : projectId;
}
```

Use `localProjectId(projectId)` anywhere existing code indexes board or recall by Claude project ID.

- [ ] **Step 6: Move renderer shared types to shared source**

In `src/renderer/src/pages/workspace-shared.ts`, import provider types:

```ts
import type { EntityId, ProviderId } from "@shared/provider-types";
```

Update `WorkspaceProject.id`, `memberIds`, `WorktreeMember.projectId`, `EnrichedPlan.projectId`, and `TimelineEvent.projectId` to use `EntityId | null` where applicable. Add `provider?: ProviderId` to display-only types while backend rollout is in progress.

- [ ] **Step 7: Run verification**

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/recall.ts src/main/services/git/index.ts src/main/router.ts src/renderer/src/pages/workspace-shared.ts src/renderer/src/pages/Workspace.tsx src/renderer/src/pages/Timeline.tsx
git commit -m "feat: normalize workspace entity ids"
```

---

### Task 8: Codex Read-Only Local Surfaces

**Files:**
- Modify: `src/main/providers/codex.ts`
- Create: `src/main/providers/codex.test.ts`
- Modify: `src/main/router.ts`
- Modify: `src/main/services/mcp.ts`

**Interfaces:**
- Produces: Codex config descriptors for user config, profile configs, and memory files.
- Produces: `GET /api/mcp?provider=codex`
- Produces: Codex catalog items for `AGENTS.md` and memory summaries as read-only entries.

- [ ] **Step 1: Write Codex provider tests**

Create `src/main/providers/codex.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { codexProvider } from "./codex.js";

describe("codex provider", () => {
  it("declares writable user config and read-only local surfaces", async () => {
    const files = await codexProvider.listConfigFiles();
    expect(files.some((f) => f.id === "codex-config" && f.format === "toml" && f.writable)).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Add Codex config discovery helpers**

In `src/main/providers/codex.ts`, add:

```ts
async function listProfileConfigs(): Promise<string[]> {
  const entries = await fs.readdir(CODEX_HOME).catch(() => [] as string[]);
  return entries
    .filter((name) => name.endsWith(".config.toml") && name !== "config.toml")
    .map((name) => path.join(CODEX_HOME, name));
}
```

Replace `listConfigFiles` with:

```ts
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
```

- [ ] **Step 3: Add Codex catalog items**

Still in `src/main/providers/codex.ts`, implement `listCatalog`:

```ts
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
```

- [ ] **Step 4: Make catalog and MCP routes provider-aware**

In `src/main/router.ts`, change `/api/catalog`:

```ts
{
  method: "GET",
  pattern: "/api/catalog",
  handler: async ({ query }) => {
    const provider = (query.provider ?? "claude") as ProviderFilter;
    return (await Promise.all(getProviders(provider).map((p) => p.listCatalog()))).flat();
  },
},
```

Change `/api/mcp`:

```ts
{
  method: "GET",
  pattern: "/api/mcp",
  handler: async ({ query }) => {
    const provider = (query.provider ?? "claude") as ProviderFilter;
    return (await Promise.all(getProviders(provider).map((p) => p.readMcpServers()))).flat();
  },
},
```

- [ ] **Step 5: Run verification**

Run:

```bash
npm run test -- src/main/providers/codex.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/main/providers/codex.ts src/main/providers/codex.test.ts src/main/router.ts src/main/services/mcp.ts
git commit -m "feat: add codex read-only surfaces"
```

---

### Task 9: Combined Normalized Workspace and Timeline

**Files:**
- Modify: `src/shared/provider-types.ts`
- Modify: `src/main/providers/claude.ts`
- Modify: `src/main/providers/codex.ts`
- Create: `src/main/services/provider-workspace.ts`
- Create: `src/main/services/provider-workspace.test.ts`
- Modify: `src/main/router.ts`

**Interfaces:**
- Produces: `NormalizedTimelineEvent`
- Produces: `GET /api/workspace/normalized/projects?provider=...`
- Produces: `GET /api/workspace/normalized/timeline?provider=...`

- [ ] **Step 1: Add normalized timeline type**

In `src/shared/provider-types.ts`, add:

```ts
export type NormalizedTimelineKind = "session" | "plan" | "memory" | "config" | "git";

export interface NormalizedTimelineEvent {
  id: EntityId;
  provider: ProviderId;
  kind: NormalizedTimelineKind;
  projectId: EntityId | null;
  title: string;
  updatedAt: string;
  sourcePath?: string;
  lastUserText?: string;
  lastAssistantText?: string;
}
```

- [ ] **Step 2: Write provider workspace tests**

Create `src/main/services/provider-workspace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sortNormalizedProjects, toTimelineEvents } from "./provider-workspace.js";

describe("provider workspace normalization", () => {
  it("sorts projects by latest activity descending", () => {
    const projects = sortNormalizedProjects([
      {
        id: "codex:local",
        provider: "codex",
        localId: "local",
        title: "Codex Local Context",
        realPath: null,
        latestActivityAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "claude:D--repo",
        provider: "claude",
        localId: "D--repo",
        title: "repo",
        realPath: "D:\\repo",
        latestActivityAt: "2026-02-01T00:00:00.000Z",
      },
    ]);
    expect(projects.map((p) => p.id)).toEqual(["claude:D--repo", "codex:local"]);
  });

  it("turns sessions and plans into timeline events", () => {
    const events = toTimelineEvents(
      [
        {
          id: "codex:memory-summary",
          provider: "codex",
          projectId: "codex:local",
          title: "memory_summary.md",
          updatedAt: "2026-03-01T00:00:00.000Z",
          sourcePath: "memory_summary.md",
        },
      ],
      [],
    );
    expect(events[0]).toMatchObject({
      id: "codex:memory-summary",
      provider: "codex",
      kind: "memory",
      projectId: "codex:local",
    });
  });
});
```

- [ ] **Step 3: Add provider workspace service**

Create `src/main/services/provider-workspace.ts`:

```ts
import type {
  NormalizedPlan,
  NormalizedProject,
  NormalizedSession,
  NormalizedTimelineEvent,
  ProviderFilter,
} from "@shared/provider-types";
import { getProviders } from "../providers/registry.js";

export function sortNormalizedProjects(projects: NormalizedProject[]): NormalizedProject[] {
  return [...projects].sort((a, b) => {
    const at = a.latestActivityAt ? Date.parse(a.latestActivityAt) : 0;
    const bt = b.latestActivityAt ? Date.parse(b.latestActivityAt) : 0;
    return bt - at;
  });
}

export function toTimelineEvents(
  sessions: NormalizedSession[],
  plans: NormalizedPlan[],
): NormalizedTimelineEvent[] {
  const events: NormalizedTimelineEvent[] = [];
  for (const s of sessions) {
    events.push({
      id: s.id,
      provider: s.provider,
      kind: s.provider === "codex" ? "memory" : "session",
      projectId: s.projectId ?? null,
      title: s.title ?? s.lastUserText ?? "(제목 없음)",
      updatedAt: s.updatedAt,
      sourcePath: s.sourcePath,
      lastUserText: s.lastUserText,
      lastAssistantText: s.lastAssistantText,
    });
  }
  for (const p of plans) {
    events.push({
      id: p.id,
      provider: p.provider,
      kind: "plan",
      projectId: p.projectId,
      title: p.title,
      updatedAt: p.updatedAt,
      sourcePath: p.sourcePath,
    });
  }
  return events.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function getNormalizedWorkspaceProjects(
  filter: ProviderFilter = "all",
): Promise<NormalizedProject[]> {
  const projects = (await Promise.all(getProviders(filter).map((p) => p.listProjects()))).flat();
  return sortNormalizedProjects(projects);
}

export async function getNormalizedTimeline(
  filter: ProviderFilter = "all",
): Promise<NormalizedTimelineEvent[]> {
  const providers = getProviders(filter);
  const [sessions, plans] = await Promise.all([
    Promise.all(providers.map((p) => p.listSessions())),
    Promise.all(providers.map((p) => p.listPlans())),
  ]);
  return toTimelineEvents(sessions.flat(), plans.flat());
}
```

- [ ] **Step 4: Implement Claude normalized methods**

In `src/main/providers/claude.ts`, import:

```ts
import { getEnrichedPlans, getWorkspaceProjects } from "../services/recall.js";
import { prefixEntityId } from "./registry.js";
```

Replace `listProjects` and `listPlans`:

```ts
async listProjects() {
  const projects = await getWorkspaceProjects();
  return projects.map((p) => ({
    id: prefixEntityId("claude", p.id),
    provider: "claude" as const,
    localId: p.id,
    title: p.board.nameOverride || p.realPath?.split(/[\\/]/).filter(Boolean).at(-1) || p.id,
    realPath: p.realPath,
    latestActivityAt: p.lastActivity ? new Date(p.lastActivity).toISOString() : null,
  }));
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
    projectId: p.projectId ? prefixEntityId("claude", p.projectId) : null,
  }));
},
```

Keep `listSessions` returning `[]` until `getProjectSessions` is adapted for bulk normalized sessions; Claude timeline compatibility remains on the existing `/api/workspace/timeline` route in v2.0.0.

- [ ] **Step 5: Implement Codex best-effort project and memory sessions**

In `src/main/providers/codex.ts`, add helpers:

```ts
async function statOrNull(p: string) {
  return fs.stat(p).catch(() => null);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function codexMemoryFiles(): Promise<string[]> {
  const memories = path.join(CODEX_HOME, "memories");
  return [
    path.join(memories, "memory_summary.md"),
    path.join(memories, "MEMORY.md"),
  ];
}
```

Replace `listProjects` and `listSessions`:

```ts
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
```

- [ ] **Step 6: Add normalized routes**

In `src/main/router.ts`, import:

```ts
import {
  getNormalizedTimeline,
  getNormalizedWorkspaceProjects,
} from "./services/provider-workspace.js";
```

Add routes near the existing workspace routes:

```ts
{
  method: "GET",
  pattern: "/api/workspace/normalized/projects",
  handler: async ({ query }) =>
    getNormalizedWorkspaceProjects((query.provider ?? "all") as ProviderFilter),
},
{
  method: "GET",
  pattern: "/api/workspace/normalized/timeline",
  handler: async ({ query }) => getNormalizedTimeline((query.provider ?? "all") as ProviderFilter),
},
```

- [ ] **Step 7: Run verification**

Run:

```bash
npm run test -- src/main/services/provider-workspace.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/provider-types.ts src/main/providers/claude.ts src/main/providers/codex.ts src/main/services/provider-workspace.ts src/main/services/provider-workspace.test.ts src/main/router.ts
git commit -m "feat: add normalized provider workspace"
```

---

### Task 10: Provider-Aware Renderer Shell

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/pages/Workspace.tsx`
- Modify: `src/renderer/src/pages/Timeline.tsx`
- Modify: `src/renderer/src/pages/Catalog.tsx`
- Modify: `src/renderer/src/pages/ConfigEditor.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: `GET /api/provider/status`
- Consumes: `GET /api/config/files?provider=...`
- Produces: provider filter values `all`, `claude`, `codex`

- [ ] **Step 1: Add provider state to App**

In `src/renderer/src/App.tsx`, import:

```ts
import type { ProviderFilter, ProviderStatus } from "@shared/provider-types";
```

Add state:

```tsx
const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
```

Replace the `/api/cc-status` polling with:

```tsx
useEffect(() => {
  let alive = true;
  const load = async () => {
    const statuses = await api.get<ProviderStatus[]>("/api/provider/status");
    if (alive) setProviderStatuses(statuses);
  };
  load().catch(() => {});
  const id = window.setInterval(() => load().catch(() => {}), 5000);
  return () => {
    alive = false;
    window.clearInterval(id);
  };
}, []);
```

- [ ] **Step 2: Render provider filter**

Add this control near the page tabs:

```tsx
<div className="provider-filter" role="tablist" aria-label="Provider filter">
  {[
    ["all", "전체"],
    ["claude", "Claude Code"],
    ["codex", "Codex"],
  ].map(([value, label]) => (
    <button
      key={value}
      className={providerFilter === value ? "active" : ""}
      onClick={() => setProviderFilter(value as ProviderFilter)}
      type="button"
    >
      {label}
    </button>
  ))}
</div>
```

Pass `providerFilter` into `Workspace`, `Timeline`, `Catalog`, and `ConfigEditor`.

- [ ] **Step 3: Update page API calls**

In each page, add prop type:

```ts
import type { ProviderFilter } from "@shared/provider-types";

interface Props {
  providerFilter: ProviderFilter;
}
```

Use query strings:

```ts
const providerQuery = `provider=${encodeURIComponent(providerFilter)}`;
api.get(`/api/catalog?${providerQuery}`);
api.get(`/api/config/files?${providerQuery}`);
```

For Workspace and Timeline, use the normalized routes from Task 9 when showing provider-combined summaries:

```ts
api.get(`/api/workspace/normalized/projects?${providerQuery}`);
api.get(`/api/workspace/normalized/timeline?${providerQuery}`);
```

Keep existing detail routes for Claude-specific rich transcript and plan expansion until their normalized replacements are implemented.

- [ ] **Step 4: Add CSS**

In `src/renderer/src/index.css`, add:

```css
.provider-filter {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.provider-filter button {
  border: 0;
  background: transparent;
  color: var(--text-dim);
  padding: 5px 9px;
  border-radius: 6px;
  cursor: pointer;
}

.provider-filter button.active {
  background: var(--hover);
  color: var(--text);
}

.provider-badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12px;
  border: 1px solid var(--border);
}
```

- [ ] **Step 5: Run verification**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/pages/Workspace.tsx src/renderer/src/pages/Timeline.tsx src/renderer/src/pages/Catalog.tsx src/renderer/src/pages/ConfigEditor.tsx src/renderer/src/index.css
git commit -m "feat: add provider-aware renderer shell"
```

---

### Task 11: Codex User Config Editing

**Files:**
- Modify: `src/main/router.ts`
- Modify: `src/main/lib/safe-write.ts`
- Modify: `src/renderer/src/pages/ConfigEditor.tsx`
- Create: `src/main/lib/config-write.ts`
- Create: `src/main/lib/config-write.test.ts`

**Interfaces:**
- Produces: `readConfigFile(fileId): Promise<{ content; mtime; sha256; descriptor }>`
- Produces: `writeConfigFile(fileId, content, baseHash)`
- Preserves: `/api/configs/:name` compatibility for Claude JSON files.

- [ ] **Step 1: Write config-write tests**

Create `src/main/lib/config-write.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateConfigContent } from "./config-write.js";

describe("config content validation", () => {
  it("validates JSON descriptors with existing JSON rules", () => {
    expect(() =>
      validateConfigContent({ id: "settings", format: "json" }, JSON.stringify({ env: {} })),
    ).not.toThrow();
  });

  it("validates TOML descriptors", () => {
    expect(() =>
      validateConfigContent({ id: "codex-config", format: "toml" }, 'model = "gpt-5.5"\n'),
    ).not.toThrow();
  });

  it("rejects Markdown writes", () => {
    expect(() => validateConfigContent({ id: "agents", format: "markdown" }, "# x")).toThrow(
      /read-only/,
    );
  });
});
```

- [ ] **Step 2: Add config-write service**

Create `src/main/lib/config-write.ts`:

```ts
import type { NormalizedConfigFile } from "@shared/provider-types";
import { validateConfig } from "./json-validate.js";
import { validateTomlConfig } from "./toml-validate.js";

type ValidationDescriptor = Pick<NormalizedConfigFile, "id" | "format">;

export function validateConfigContent(desc: ValidationDescriptor, content: string): void {
  if (desc.format === "json") {
    validateConfig(desc.id, content);
    return;
  }
  if (desc.format === "toml") {
    validateTomlConfig(desc.id, content);
    return;
  }
  throw Object.assign(new Error("read-only config format"), { statusCode: 403 });
}
```

- [ ] **Step 3: Update safeWrite to accept validator and backup root**

In `src/main/lib/safe-write.ts`, add option types:

```ts
export type SafeWriteValidator = (name: string, content: string) => void;

export interface SafeWriteOptions {
  validate?: SafeWriteValidator;
  backupDir?: string;
}
```

Change the `safeWrite` signature:

```ts
export async function safeWrite(
  name: string,
  filePath: string,
  content: string,
  baseHash: string,
  options: SafeWriteOptions = {},
): Promise<{ sha256: string; backup: string }> {
```

Inside `safeWrite`, derive the validator and backup root:

```ts
const validate = options.validate ?? validateConfig;
const backupDir = options.backupDir ?? BACKUP_DIR;
validate(name, content);
```

Replace `BACKUP_DIR` inside `safeWrite` with `backupDir` for `mkdir`, backup file creation, and `rotateBackups`. Keep `listBackups` and `restoreBackup` on `BACKUP_DIR` because those routes are still Claude JSON compatibility routes.

Leave `restoreBackup` JSON-only until provider-specific backup restore is designed.

- [ ] **Step 4: Add provider config read/write routes**

In `src/main/router.ts`, add helper near `configEntry`:

```ts
async function providerConfigEntry(id: string) {
  for (const provider of getProviders("all")) {
    const files = await provider.listConfigFiles();
    const found = files.find((f) => f.id === id);
    if (found) return found;
  }
  throw new HttpError(404, `unknown config file: ${id}`);
}
```

Add routes:

```ts
{
  method: "GET",
  pattern: "/api/config/file/:id",
  handler: async ({ params }) => {
    const entry = await providerConfigEntry(params.id);
    const data = await readConfig(entry.path);
    return { ...data, ...entry };
  },
},
{
  method: "PUT",
  pattern: "/api/config/file/:id",
  handler: async ({ params, body }) => {
    const entry = await providerConfigEntry(params.id);
    if (!entry.writable) throw new HttpError(403, "읽기 전용 파일");
    const { content, baseHash } = body as { content: string; baseHash: string };
    if (typeof content !== "string" || typeof baseHash !== "string") {
      throw new HttpError(400, "content/baseHash 필요");
    }
    return safeWrite(entry.id, entry.path, content, baseHash, {
      backupDir: APP_BACKUP_DIR,
      validate: (_name, text) => validateConfigContent(entry, text),
    });
  },
},
```

Import `validateConfigContent` from `./lib/config-write.js`.
Import `APP_BACKUP_DIR` from `./config.js`.

- [ ] **Step 5: Update ConfigEditor**

In `src/renderer/src/pages/ConfigEditor.tsx`, make the file list come from `/api/config/files`. When a file is selected, read via `/api/config/file/:id`. For `format === "toml"`, use the existing text mode surface and disable JSON tree mode with this message:

```tsx
{activeFile.format === "toml" && (
  <div className="notice">TOML 파일은 텍스트 편집 후 저장 시 구문 검증을 수행합니다.</div>
)}
```

Save to:

```ts
await api.put(`/api/config/file/${encodeURIComponent(activeFile.id)}`, {
  content,
  baseHash,
});
```

- [ ] **Step 6: Run verification**

Run:

```bash
npm run test -- src/main/lib/config-write.test.ts
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/main/lib/config-write.ts src/main/lib/config-write.test.ts src/main/lib/safe-write.ts src/main/router.ts src/renderer/src/pages/ConfigEditor.tsx
git commit -m "feat: edit provider config files safely"
```

---

### Task 12: Packaging and v2 Release Verification

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/release.yml` only if release asset output is wrong in CI dry run.
- Create: `docs/release/v2.0.0.md`

**Interfaces:**
- Produces: user-visible product name `Harness Manager`
- Produces: release asset names `Harness-Manager-*`
- Preserves: updater repo `rafaam11/harness-manager`

- [ ] **Step 1: Verify package metadata**

Ensure `package.json` has exactly these visible release fields:

```json
"description": "Claude Code와 Codex 로컬 환경을 관리하는 로컬 전용 데스크톱 앱",
"build": {
  "appId": "com.digitrack.claudeharnessmanager",
  "productName": "Harness Manager",
  "artifactName": "Harness-Manager-Setup-${version}.${ext}",
  "nsis": {
    "shortcutName": "Harness Manager"
  },
  "linux": {
    "artifactName": "Harness-Manager-${version}-${arch}.${ext}",
    "synopsis": "Claude Code와 Codex 로컬 환경 관리 데스크톱 앱"
  }
}
```

Keep all existing build targets and `build.publish` values unchanged.

- [ ] **Step 2: Add release note draft**

Create `docs/release/v2.0.0.md`:

```md
# Harness Manager v2.0.0

## Summary

Claude Harness Manager is now Harness Manager. Existing Claude Code workflows remain supported, and v2 adds Codex local environment visibility plus safe editing for user-level Codex config.

## Compatibility

- Existing Claude Code data is preserved.
- Existing board state is migrated non-destructively into provider-prefixed schema v2.
- The app keeps the existing appId for updater continuity.

## Codex Scope

- Read-only: Codex local config descriptors, MCP servers, instructions, and memories.
- Writable: user-level `~/.codex/config.toml` after TOML validation.
- Not included: Codex cloud/web sync, memory editing, and automatic `AGENTS.md` edits.

## Verification

- `npm run test`
- `npm run typecheck`
- `npm run build`
- Windows: `npm run dist`
- Linux: `npm run dist:linux` in CI or a Linux-capable environment
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run local Windows packaging**

On Windows, run:

```bash
npm run dist
```

Expected: `release/` contains `Harness-Manager-Setup-2.0.0.exe`, `latest.yml`, and a `.blockmap` file after the package version is set to `2.0.0`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .github/workflows/release.yml docs/release/v2.0.0.md
git commit -m "chore: prepare Harness Manager v2 release"
```

---

## Execution Order

Execute tasks in order. Do not start Task 7 before Task 6 is merged because board key migration affects project/session IDs. Do not start Task 11 before Task 5 is merged because Codex config writes depend on TOML validation. Do not run packaging in Task 12 until `npm run test`, `npm run typecheck`, and `npm run build` pass on the final tree.

## Final Acceptance

- `npm run test` exits 0.
- `npm run typecheck` exits 0.
- `npm run build` exits 0.
- Existing Claude Code Workspace, Catalog, Config, Cleanup, and Git behavior remains available.
- Codex `~/.codex/config.toml` is visible and editable after validation.
- Codex MCP servers are visible read-only.
- Codex instructions and memories are visible read-only.
- Board migration is non-destructive and provider-prefixed.
- Visible app name and release assets use `Harness Manager` / `Harness-Manager-*`.
