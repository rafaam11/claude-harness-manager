# Task 8 Report

## Files changed
- `src/main/providers/codex.ts`
- `src/main/providers/codex.test.ts`
- `src/main/router.ts`

## Commits
- `feat: add codex read-only surfaces`

## Test commands
- `npm run test -- src/main/providers/codex.test.ts` - PASS
- `npm run typecheck` - PASS
- `npm run build` - PASS

## PASS/FAIL summary
- PASS: Codex provider now discovers `config.toml` plus `*.config.toml` profile files.
- PASS: Codex provider exposes read-only catalog entries for `AGENTS.md`, `AGENTS.override.md`, `memory_summary.md`, and `MEMORY.md`.
- PASS: `GET /api/catalog` and `GET /api/mcp` now accept `provider=claude|codex|all`.
- PASS: No-query behavior for `/api/catalog` and `/api/mcp` remains Claude-only.
- PASS: Claude MCP and catalog behavior remain unchanged when routed through the provider registry.

## Self-review notes
- Kept the change scoped to provider discovery and route fan-out; no workspace/timeline aggregation was added.
- Did not add Codex config editing or write paths beyond existing config descriptors.
- Reused `parseProviderFilter` and `getProviders` instead of unsafe provider casts in the new routes.
- Left `src/main/services/mcp.ts` unchanged because existing Claude-only behavior remains correct and Codex MCP parsing is already handled in the Codex provider.

## Concerns
- None at this time.

## Fix
- Files changed: `src/main/router.ts`, `src/main/router.test.ts`
- Commit: `5c9be741447b46d06b5c767970c42c7969fd45f2`

## Test commands
- `npm run test -- src/main/router.test.ts src/main/providers/codex.test.ts` - PASS
- `npm run typecheck` - PASS
- `npm run build` - PASS

## PASS/FAIL summary
- PASS: `/api/catalog` and `/api/mcp` default to Claude only when `provider` is missing.
- PASS: `provider=claude`, `provider=codex`, and `provider=all` resolve correctly.
- PASS: `provider=` and invalid provider values now fail with a 400-level `HttpError`.
- PASS: `src/main/providers/codex.test.ts` still passes alongside the router contract test.
