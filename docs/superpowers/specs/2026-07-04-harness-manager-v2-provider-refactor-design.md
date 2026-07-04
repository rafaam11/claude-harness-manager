# Harness Manager v2 Provider Refactor Design

## Context

Harness Manager is currently implemented as a local Electron app for managing a Claude Code environment. The v2.0.0 goal is to keep the existing Claude Code workflows working while adding Codex support and renaming the visible product to `Harness Manager`.

The core refactor should not be a string replacement from Claude paths to Codex paths. Claude Code and Codex expose different local surfaces:

- Claude Code currently drives this app through `~/.claude`, `~/.claude.json`, flattened project directories, transcript JSONL files, plans, tasks, and hooks.
- Codex uses documented surfaces such as `~/.codex/config.toml`, project `.codex/config.toml`, `AGENTS.md`, MCP tables in `config.toml`, plugins, skills, and memories under the Codex home directory.

The architecture should become a provider-neutral shell backed by provider adapters.

## Goals

- Preserve existing Claude Code features and data.
- Add Codex local environment visibility.
- Support safe editing of Codex user-level config.
- Keep Git workbench behavior provider-neutral.
- Move app-owned state to a neutral, versioned schema.
- Rename user-visible branding to `Harness Manager`.
- Release as v2.0.0 with automatic update continuity where practical.

## Non-Goals

- Codex cloud, web, or remote session synchronization.
- ChatGPT connector account management.
- Automatic editing of Codex memories.
- Automatic editing of `AGENTS.md`.
- Automatic editing of project `.codex/config.toml` before trust semantics are designed.
- GitHub PR/review integration.
- Full Codex transcript parity in v2.0.0.

## Architecture

The main process should expose the same broad API families while routing provider-specific work through a registry.

```text
renderer
  -> /api/workspace, /api/timeline, /api/catalog, /api/config, /api/git
main router
  -> provider registry
    -> claude adapter
    -> codex adapter
  -> shared safety layer
    -> path guard, safe write, archive, board, git guard
```

Introduce `src/main/providers/` with a small contract:

```ts
type ProviderId = "claude" | "codex";

interface ProviderAdapter {
  id: ProviderId;
  label: string;
  roots: ProviderRoots;
  listConfigFiles(): Promise<NormalizedConfigFile[]>;
  readMcpServers(): Promise<McpServer[]>;
  listCatalog(): Promise<CatalogSections>;
  listProjects(): Promise<NormalizedProject[]>;
  listSessions(): Promise<NormalizedSession[]>;
  listPlans(): Promise<NormalizedPlan[]>;
  detectRunning(): Promise<boolean>;
}
```

Existing safe-write, lock, backup, archive-not-delete, and git repo guard code should remain shared. The important change is that allowed roots come from registered providers plus an app-owned data root, not from a single Claude constant.

## Data Model

Renderer-facing IDs should include provider namespace.

```ts
type ProviderId = "claude" | "codex";
type EntityId = `${ProviderId}:${string}`;

type NormalizedSession = {
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
};

type NormalizedConfigFile = {
  id: string;
  provider: ProviderId;
  label: string;
  path: string;
  format: "json" | "toml" | "markdown";
  writable: boolean;
};
```

Board state should move to schema v2. Existing keys migrate by adding `claude:` prefixes. New Codex keys use `codex:` prefixes.

```json
{
  "schemaVersion": 2,
  "projects": {
    "claude:<projectId>": {},
    "codex:<projectId>": {}
  },
  "sessions": {
    "claude:<sessionId>": {},
    "codex:<sessionId>": {}
  }
}
```

Migration must be non-destructive. The old board file is read but not modified.

## API Strategy

Do not break renderer routes all at once. Add provider selection while preserving Claude defaults during early phases.

```text
GET /api/workspace?provider=all
GET /api/timeline?provider=all
GET /api/catalog?provider=claude|codex|all
GET /api/config/files?provider=claude|codex
GET /api/provider/status
```

Existing endpoints may remain as compatibility wrappers until renderer migration is complete.

Git routes continue to receive `projectId`, but the ID is provider-prefixed. The Git service should resolve repo paths through normalized project data and board overrides. Low-level Git services remain provider-independent.

## Phase Plan

### Phase 0: Safety Hardening and Release Policy

Before adding Codex roots, narrow path checks.

- Restrict cleanup archive categories to an explicit allowlist.
- Verify archive destinations stay under the intended archive root.
- Add subtree guards for project file browsing and backup paths.
- Document release identity policy.

Completion criteria:

- Existing Claude behavior is unchanged.
- `npm run typecheck` passes.
- `npm run build` passes.

### Phase 1: Provider Contract

Add the provider registry and wrap current Claude behavior behind `claudeProvider`.

- Move Claude root/config/catalog/recall/process assumptions behind the adapter boundary.
- Add a shallow `codexProvider` for roots, config descriptors, MCP descriptors, and process status.
- Keep existing routes stable while internally consulting the provider registry.

Completion criteria:

- Claude UI works as before.
- Main code has a clear provider boundary.
- Codex can be detected and basic config files can be listed read-only.

### Phase 2: Workspace and Timeline Normalization

Normalize Claude and Codex sources into common project/session/timeline models.

- Convert Claude recall output into normalized models.
- Add Codex best-effort recall from documented local state and memory files.
- Update repo grouping and Git resolution for provider-prefixed IDs.
- Migrate board to schema v2.

Completion criteria:

- Workspace can display Claude and Codex entries together.
- Existing Claude session and plan behavior is preserved.
- Git works for either provider when a repo path is known.

### Phase 3: Catalog, Config, and MCP UI

Make renderer pages provider-aware.

- Replace `ccRunning` with provider statuses.
- Replace Claude-only labels in Config, Catalog, Workspace, Timeline, and Glossary.
- Show JSON, TOML, and Markdown config-like files with format badges.
- Render Codex MCP servers from `[mcp_servers.*]` in `config.toml`.

Completion criteria:

- UI labels accurately distinguish Claude Code and Codex.
- Codex config/MCP/instruction surfaces are visible.
- No Claude-specific wording appears in provider-neutral UI areas.

### Phase 4: Codex Write/Edit and Migration

Open Codex writes conservatively.

- Add TOML parse validation for `~/.codex/config.toml`.
- Allow user-level Codex config editing.
- Keep project `.codex/config.toml` read-only until trust rules are designed.
- Keep `AGENTS.md`, memories, and session/log files read-only.
- Store app-owned state in a neutral location with schema versioning.

Completion criteria:

- Codex user config can be edited safely.
- Invalid TOML is rejected before write.
- Existing Claude board data is preserved after migration.

### Phase 5: v2.0.0 Packaging and Release

Rename visible product surfaces.

- `productName`: `Harness Manager`
- Windows installer: `Harness-Manager-Setup-${version}.exe`
- Linux AppImage: `Harness-Manager-${version}-${arch}.AppImage`
- Shortcut name: `Harness Manager`
- Description: `Claude Code와 Codex 로컬 환경을 관리하는 데스크톱 앱`

Keep `appId` as `com.digitrack.claudeharnessmanager` for v2 unless a separate migration plan proves that changing it will not break automatic update continuity.

Completion criteria:

- v2 updates from existing installed versions where electron-updater supports it.
- Release notes explain the rename and Codex support.
- GitHub Actions publish the new asset names and expected update manifests.

## Codex Adapter Scope

### Stable Read Scope

- `~/.codex/config.toml`
- `~/.codex/<profile>.config.toml`
- Project `.codex/config.toml` as read-only
- Global and project `AGENTS.md` / `AGENTS.override.md`
- MCP tables in `config.toml`
- `~/.codex/memories/`
- Codex process status

### Best-Effort Recall Scope

- Codex log files when `log_dir` is configured.
- `~/.codex/memories/rollout_summaries/`.
- Memory summaries and evidence files.
- Session IDs, cwd, model, prompts, and responses only when extractable.

Missing Codex recall data must not be treated as an error.

### Write Scope

Allowed in v2.0.0:

- App-owned board/state.
- `~/.codex/config.toml` after TOML validation.

Read-only in v2.0.0:

- Project `.codex/config.toml`.
- `AGENTS.md`.
- Codex memories.
- Codex session/log files.

## Renderer UX

Use a global provider filter:

```text
전체 | Claude Code | Codex
```

Default to `전체`.

Workspace remains the main combined view. Cards show provider badges. If the same Git repository has both Claude and Codex traces, the card may show both providers while board keys remain provider-prefixed.

Timeline uses normalized event types:

```ts
type TimelineEvent = "session" | "plan" | "memory" | "config" | "git";
```

Catalog groups provider capabilities:

- Claude Code: skills, agents, commands, MCP, plugins.
- Codex: AGENTS.md, skills, plugins, MCP, rules/hooks.

Config Editor becomes file-oriented:

- Claude Code: `settings.json`, `settings.local.json`, `.claude.json` read-only.
- Codex: `~/.codex/config.toml`, profile configs, project `.codex/config.toml` read-only.

## Testing and Verification

Add a lightweight test runner, preferably Vitest, for pure modules.

Initial test coverage should include:

- Provider adapter normalization functions.
- Path and subtree guards.
- Board schema migration.
- TOML parse validation.
- Recall normalization fixtures.

Required verification remains:

```bash
npm run typecheck
npm run build
```

Packaging verification:

```bash
npm run dist
npm run dist:linux
```

Linux packaging may run only in CI or a Linux-capable environment.

## Release Checklist

- Existing Claude Workspace, Catalog, Config, Cleanup, and Git behavior is not regressed.
- Codex `~/.codex/config.toml` is visible and user-level editing works.
- Codex MCP servers are visible read-only.
- Codex instructions and memories are visible read-only.
- Board migration is non-destructive.
- Git works for `claude:` and `codex:` projects when repo paths are known.
- Visible app name is `Harness Manager`.
- Installer/AppImage asset names use `Harness-Manager-*`.
- Release notes explain that Claude functionality remains and Codex local support was added.

## Main Risks

- Codex recall parity is not guaranteed in v2.0.0. Treat recall as best-effort unless there is a stable local session source.
- Changing `appId` may break automatic update continuity.
- Adding provider roots without Phase 0 path hardening increases filesystem risk.
- TOML editing should not use the existing JSON tree editor path.

## Open Decisions

- Exact app-owned state path. Prefer an explicit stable path rather than relying only on productName-derived `app.getPath("userData")`.
- Whether provider filter state is global across pages or page-local.
- Whether same-repo Claude/Codex traces are merged into one Workspace card immediately or after normalized recall stabilizes.
- Whether Vitest is introduced in Phase 0 or Phase 1.
