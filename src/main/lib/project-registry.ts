import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import type {
  ProjectRegistryV1,
  ProjectSource,
  ProjectStatus,
  SharedProject,
  SharedProjectTrack,
} from "@shared/project-registry";
import {
  APP_BACKUP_DIR,
  BOARD_FILE,
  BOARD_FILE_V2,
  PROJECT_REGISTRY_FILE,
} from "../config.js";
import { readBoard, type BoardData, type ProjectBoardEntry } from "./board.js";

export class ProjectRegistryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRegistryValidationError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROJECT_SOURCES = new Set<ProjectSource>(["manual", "claude", "codex"]);
const PROJECT_STATUSES = new Set<ProjectStatus>(["진행중", "보류", "완료", "보관"]);
const SOURCE_ORDER: readonly ProjectSource[] = ["manual", "claude", "codex"];
const DEFAULT_LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_DELAY_MS = 50;

export interface ProjectRegistryOptions {
  filePath?: string;
  lockTimeoutMs?: number;
  now?: () => Date;
}

export interface ProjectRegistryMigrationOptions extends ProjectRegistryOptions {
  boardFilePath?: string;
  backupDir?: string;
}

export interface DiscoveredProject {
  rootPath: string;
  source: ProjectSource;
  providerRef?: string;
  displayName?: string | null;
}

export interface LegacyBoardProject {
  status?: string;
  memo?: string;
  nameOverride?: string;
  tracks?: SharedProjectTrack[];
  repoPath?: string;
  hidden?: boolean;
  order?: number;
}

export interface RegistryProjectPatch {
  status?: string;
  memo?: string;
  nameOverride?: string | null;
  tracks?: SharedProjectTrack[];
  repoPath?: string | null;
  hidden?: boolean;
  order?: number | null;
}

export class ProjectRegistryProjectNotFoundError extends Error {
  statusCode = 404;

  constructor(ids: readonly string[]) {
    super(`No shared project matches: ${ids.join(", ")}`);
    this.name = "ProjectRegistryProjectNotFoundError";
  }
}

export class ProjectRegistryLockTimeoutError extends Error {
  statusCode = 503;

  constructor(filePath: string) {
    super(`Timed out waiting for project registry lock: ${filePath}`);
    this.name = "ProjectRegistryLockTimeoutError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new ProjectRegistryValidationError(`${field} must be an object`);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new ProjectRegistryValidationError(`${field} has unknown fields: ${unknown.join(", ")}`);
  }
}

function assertString(value: unknown, field: string, allowEmpty = true): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new ProjectRegistryValidationError(`${field} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
}

function assertIsoTimestamp(value: unknown, field: string): asserts value is string {
  assertString(value, field, false);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ProjectRegistryValidationError(`${field} must be an ISO timestamp`);
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ProjectRegistryValidationError(`${field} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    throw new ProjectRegistryValidationError(`${field} must not contain duplicates`);
  }
}

function validateTracks(value: unknown, field: string): asserts value is SharedProjectTrack[] {
  if (!Array.isArray(value)) throw new ProjectRegistryValidationError(`${field} must be an array`);
  for (const [trackIndex, trackValue] of value.entries()) {
    const trackField = `${field}[${trackIndex}]`;
    assertRecord(trackValue, trackField);
    assertExactKeys(trackValue, ["id", "title", "items"], trackField);
    assertString(trackValue.id, `${trackField}.id`, false);
    assertString(trackValue.title, `${trackField}.title`);
    if (!Array.isArray(trackValue.items)) {
      throw new ProjectRegistryValidationError(`${trackField}.items must be an array`);
    }
    for (const [itemIndex, itemValue] of trackValue.items.entries()) {
      const itemField = `${trackField}.items[${itemIndex}]`;
      assertRecord(itemValue, itemField);
      assertExactKeys(itemValue, ["id", "text", "done"], itemField);
      assertString(itemValue.id, `${itemField}.id`, false);
      assertString(itemValue.text, `${itemField}.text`);
      if (typeof itemValue.done !== "boolean") {
        throw new ProjectRegistryValidationError(`${itemField}.done must be a boolean`);
      }
    }
  }
}

function validateProject(value: unknown, key: string): asserts value is SharedProject {
  const field = `projects.${key}`;
  assertRecord(value, field);
  assertExactKeys(
    value,
    [
      "id",
      "rootPath",
      "displayName",
      "sources",
      "providerRefs",
      "status",
      "memo",
      "tracks",
      "hidden",
      "order",
      "createdAt",
      "updatedAt",
    ],
    field,
  );
  assertString(value.id, `${field}.id`, false);
  if (!UUID_PATTERN.test(value.id) || value.id !== key) {
    throw new ProjectRegistryValidationError(`${field}.id must be a UUID equal to its map key`);
  }
  assertString(value.rootPath, `${field}.rootPath`, false);
  if (value.displayName !== null) assertString(value.displayName, `${field}.displayName`);
  if (
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    value.sources.some((source) => !PROJECT_SOURCES.has(source as ProjectSource)) ||
    new Set(value.sources).size !== value.sources.length
  ) {
    throw new ProjectRegistryValidationError(`${field}.sources must contain unique supported sources`);
  }
  assertRecord(value.providerRefs, `${field}.providerRefs`);
  assertExactKeys(value.providerRefs, ["claude", "codex"], `${field}.providerRefs`);
  assertStringArray(value.providerRefs.claude, `${field}.providerRefs.claude`);
  assertStringArray(value.providerRefs.codex, `${field}.providerRefs.codex`);
  if (value.providerRefs.claude.some((providerRef) => providerRef.includes(":"))) {
    throw new ProjectRegistryValidationError(`${field}.providerRefs.claude must contain raw project ids`);
  }
  if (value.providerRefs.codex.some((providerRef) => !/^codex:.+/.test(providerRef))) {
    throw new ProjectRegistryValidationError(`${field}.providerRefs.codex must use codex:<id>`);
  }
  const sources = value.sources as ProjectSource[];
  if (
    (value.providerRefs.claude.length > 0 && !sources.includes("claude")) ||
    (value.providerRefs.codex.length > 0 && !sources.includes("codex"))
  ) {
    throw new ProjectRegistryValidationError(`${field}.providerRefs must match project sources`);
  }
  if (value.status !== null && !PROJECT_STATUSES.has(value.status as ProjectStatus)) {
    throw new ProjectRegistryValidationError(`${field}.status is invalid`);
  }
  assertString(value.memo, `${field}.memo`);
  validateTracks(value.tracks, `${field}.tracks`);
  if (typeof value.hidden !== "boolean") {
    throw new ProjectRegistryValidationError(`${field}.hidden must be a boolean`);
  }
  if (value.order !== null && (!Number.isInteger(value.order) || (value.order as number) < 0)) {
    throw new ProjectRegistryValidationError(`${field}.order must be a non-negative integer or null`);
  }
  assertIsoTimestamp(value.createdAt, `${field}.createdAt`);
  assertIsoTimestamp(value.updatedAt, `${field}.updatedAt`);
}

export function validateProjectRegistry(value: unknown): ProjectRegistryV1 {
  assertRecord(value, "registry");
  assertExactKeys(value, ["schemaVersion", "updatedAt", "migratedFromBoardAt", "projects"], "registry");
  if (value.schemaVersion !== 1) {
    throw new ProjectRegistryValidationError("registry.schemaVersion must be 1");
  }
  assertIsoTimestamp(value.updatedAt, "registry.updatedAt");
  if (value.migratedFromBoardAt !== undefined) {
    assertIsoTimestamp(value.migratedFromBoardAt, "registry.migratedFromBoardAt");
  }
  assertRecord(value.projects, "registry.projects");
  for (const [key, project] of Object.entries(value.projects)) validateProject(project, key);
  const rootOwners = new Map<string, string>();
  const providerRefOwners = {
    claude: new Map<string, string>(),
    codex: new Map<string, string>(),
  };
  for (const [key, project] of Object.entries(value.projects as Record<string, SharedProject>)) {
    const rootKey = normalizeProjectPath(project.rootPath);
    const rootOwner = rootOwners.get(rootKey);
    if (rootOwner) {
      throw new ProjectRegistryValidationError(
        `projects.${key}.rootPath duplicates project ${rootOwner}`,
      );
    }
    rootOwners.set(rootKey, key);
    for (const provider of ["claude", "codex"] as const) {
      for (const providerRef of project.providerRefs[provider]) {
        const owner = providerRefOwners[provider].get(providerRef);
        if (owner) {
          throw new ProjectRegistryValidationError(
            `projects.${key}.providerRefs.${provider} duplicates project ${owner}`,
          );
        }
        providerRefOwners[provider].set(providerRef, key);
      }
    }
  }
  return value as unknown as ProjectRegistryV1;
}

function currentIso(options: ProjectRegistryOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function emptyRegistry(now: string): ProjectRegistryV1 {
  return { schemaVersion: 1, updatedAt: now, projects: {} };
}

function resolvedProjectPath(rootPath: string): string {
  return path.resolve(rootPath);
}

/** Lexical identity only: missing paths remain valid and Windows matching is case-insensitive. */
export function normalizeProjectPath(rootPath: string): string {
  const resolved = resolvedProjectPath(rootPath).replace(/\\/g, "/");
  const withoutTrailingSlash = resolved.length > 1 ? resolved.replace(/\/+$/, "") : resolved;
  return process.platform === "win32" ? withoutTrailingSlash.toLocaleLowerCase("en-US") : withoutTrailingSlash;
}

async function readRegistryFile(filePath: string, now: string): Promise<ProjectRegistryV1> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRegistry(now);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ProjectRegistryValidationError(
      `Project registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateProjectRegistry(parsed);
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const handle = await fs.open(temporaryPath, "wx");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeRegistryAtomic(filePath: string, registry: ProjectRegistryV1): Promise<void> {
  const current = await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (current) {
    const currentText = current.toString("utf8");
    let currentIsValid = false;
    try {
      validateProjectRegistry(JSON.parse(currentText));
      currentIsValid = true;
    } catch {
      // Preserve the last known-good backup when a non-cooperating writer corrupts the primary.
    }
    if (currentIsValid) await writeFileAtomic(`${filePath}.bak`, currentText);
  }
  await writeFileAtomic(filePath, `${JSON.stringify(registry, null, 2)}\n`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireRegistryLock(filePath: string, timeoutMs: number): Promise<() => Promise<void>> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    try {
      return await lockfile.lock(filePath, {
        realpath: false,
        retries: 0,
        stale: 10_000,
        update: 2_000,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED" || Date.now() >= deadline) {
        if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
          throw new ProjectRegistryLockTimeoutError(filePath);
        }
        throw error;
      }
      await sleep(Math.min(LOCK_RETRY_DELAY_MS, Math.max(1, deadline - Date.now())));
    }
  }
}

export async function readProjectRegistry(
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryV1> {
  const filePath = options.filePath ?? PROJECT_REGISTRY_FILE;
  const now = currentIso(options);
  try {
    return await readRegistryFile(filePath, now);
  } catch (error) {
    if (!(error instanceof ProjectRegistryValidationError)) throw error;
    try {
      return await readRegistryFile(`${filePath}.bak`, now);
    } catch {
      throw error;
    }
  }
}

export async function updateProjectRegistry(
  update: (
    registry: ProjectRegistryV1,
  ) => void | ProjectRegistryV1 | Promise<void | ProjectRegistryV1>,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryV1> {
  const filePath = options.filePath ?? PROJECT_REGISTRY_FILE;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const release = await acquireRegistryLock(
    filePath,
    options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
  );
  try {
    const now = currentIso(options);
    const current = await readRegistryFile(filePath, now);
    const draft = structuredClone(current);
    const replacement = await update(draft);
    const next = replacement ?? draft;
    next.updatedAt = now;
    validateProjectRegistry(next);
    await writeRegistryAtomic(filePath, next);
    return next;
  } finally {
    await release();
  }
}

function sortedSources(sources: Iterable<ProjectSource>): ProjectSource[] {
  const values = new Set(sources);
  return SOURCE_ORDER.filter((source) => values.has(source));
}

function canonicalProviderRef(source: Exclude<ProjectSource, "manual">, providerRef: string): string {
  const trimmed = providerRef.trim();
  if (source === "claude") return trimmed.startsWith("claude:") ? trimmed.slice("claude:".length) : trimmed;
  return trimmed.startsWith("codex:") ? trimmed : `codex:${trimmed}`;
}

function findProjectForDiscovery(
  registry: ProjectRegistryV1,
  discovery: DiscoveredProject,
): SharedProject | undefined {
  const pathKey = normalizeProjectPath(discovery.rootPath);
  const projects = Object.values(registry.projects);
  const byPath = projects.find((project) => normalizeProjectPath(project.rootPath) === pathKey);
  if (byPath) return byPath;
  const source = discovery.source;
  if (discovery.providerRef && source !== "manual") {
    const providerRef = canonicalProviderRef(source, discovery.providerRef);
    return projects.find((project) => project.providerRefs[source].includes(providerRef));
  }
  return undefined;
}

function applyDiscovery(
  registry: ProjectRegistryV1,
  discovery: DiscoveredProject,
  now: string,
): void {
  if (!discovery.rootPath.trim()) {
    throw new ProjectRegistryValidationError("discovery.rootPath must be non-empty");
  }
  let project = findProjectForDiscovery(registry, discovery);
  if (!project) {
    const id = randomUUID();
    project = {
      id,
      rootPath: resolvedProjectPath(discovery.rootPath),
      displayName: discovery.displayName?.trim() || null,
      sources: [discovery.source],
      providerRefs: { claude: [], codex: [] },
      status: null,
      memo: "",
      tracks: [],
      hidden: false,
      order: null,
      createdAt: now,
      updatedAt: now,
    };
    registry.projects[id] = project;
  }

  let changed = false;
  const sources = sortedSources([...project.sources, discovery.source]);
  if (sources.join("\0") !== project.sources.join("\0")) {
    project.sources = sources;
    changed = true;
  }
  if (discovery.source !== "manual" && discovery.providerRef) {
    const providerRef = canonicalProviderRef(discovery.source, discovery.providerRef);
    for (const candidate of Object.values(registry.projects)) {
      if (candidate.id === project.id) continue;
      const refs = candidate.providerRefs[discovery.source];
      if (!refs.includes(providerRef)) continue;
      candidate.providerRefs[discovery.source] = refs.filter((value) => value !== providerRef);
      candidate.updatedAt = now;
    }
    const refs = project.providerRefs[discovery.source];
    if (
      refs.includes(providerRef) &&
      normalizeProjectPath(project.rootPath) !== normalizeProjectPath(discovery.rootPath)
    ) {
      project.rootPath = resolvedProjectPath(discovery.rootPath);
      changed = true;
    }
    if (!refs.includes(providerRef)) {
      refs.push(providerRef);
      refs.sort();
      changed = true;
    }
  }
  if (!project.displayName && discovery.displayName?.trim()) {
    project.displayName = discovery.displayName.trim();
    changed = true;
  }
  if (changed) project.updatedAt = now;
}

export async function reconcileDiscoveredProjects(
  discoveries: readonly DiscoveredProject[],
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryV1> {
  return updateProjectRegistry((registry) => {
    const now = currentIso(options);
    for (const discovery of discoveries) applyDiscovery(registry, discovery, now);
  }, options);
}

export function projectRegistryNeedsReconciliation(
  registry: ProjectRegistryV1,
  discoveries: readonly DiscoveredProject[],
): boolean {
  return discoveries.some((discovery) => {
    const project = findProjectForDiscovery(registry, discovery);
    if (!project || !project.sources.includes(discovery.source)) return true;
    if (normalizeProjectPath(project.rootPath) !== normalizeProjectPath(discovery.rootPath)) return true;
    if (discovery.source !== "manual" && discovery.providerRef) {
      const providerRef = canonicalProviderRef(discovery.source, discovery.providerRef);
      if (!project.providerRefs[discovery.source].includes(providerRef)) return true;
    }
    return !project.displayName && !!discovery.displayName?.trim();
  });
}

function firstText(
  entries: readonly LegacyBoardProject[],
  pick: (entry: LegacyBoardProject) => unknown,
): string | null {
  for (const entry of entries) {
    const value = pick(entry);
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function firstTracks(entries: readonly LegacyBoardProject[]): SharedProjectTrack[] | null {
  for (const entry of entries) {
    if (Array.isArray(entry.tracks) && entry.tracks.length > 0) return structuredClone(entry.tracks);
  }
  return null;
}

function firstOrder(entries: readonly LegacyBoardProject[]): number | null {
  for (const entry of entries) {
    if (typeof entry.order === "number" && Number.isInteger(entry.order) && entry.order >= 0) {
      return entry.order;
    }
  }
  return null;
}

const STATUS_ARCHIVE_RANK: Record<ProjectStatus, number> = {
  진행중: 0,
  보류: 1,
  완료: 2,
  보관: 3,
};

function leastArchivedStatus(entries: readonly LegacyBoardProject[]): ProjectStatus | null {
  let best: ProjectStatus | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const status = PROJECT_STATUSES.has(entry.status as ProjectStatus)
      ? (entry.status as ProjectStatus)
      : null;
    const rank = status === null ? 0 : STATUS_ARCHIVE_RANK[status];
    if (rank < bestRank || (rank === bestRank && best === null && status !== null)) {
      best = status;
      bestRank = rank;
    }
  }
  return best;
}

async function existingBoardPath(explicitPath?: string): Promise<string | null> {
  const candidates = explicitPath ? [explicitPath] : [BOARD_FILE_V2, BOARD_FILE];
  for (const candidate of candidates) {
    const exists = await fs
      .access(candidate)
      .then(() => true)
      .catch(() => false);
    if (exists) return candidate;
  }
  return null;
}

async function backupBoardBeforeMigration(
  options: ProjectRegistryMigrationOptions,
  now: string,
): Promise<void> {
  const boardPath = await existingBoardPath(options.boardFilePath);
  if (!boardPath) return;
  const content = await fs.readFile(boardPath, "utf8");
  const backupDir = options.backupDir ?? APP_BACKUP_DIR;
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = now.replace(/[:.]/g, "-");
  const backupPath = path.join(
    backupDir,
    `${path.basename(boardPath)}.${stamp}.pre-project-registry-migration.bak`,
  );
  await writeFileAtomic(backupPath, content);
}

/**
 * One-way metadata migration. board.json remains byte-for-byte untouched and is retained as a
 * fallback; migratedFromBoardAt prevents stale legacy values from overwriting shared edits later.
 */
export async function migrateBoardProjectsToRegistry(
  legacyProjects: Readonly<Record<string, LegacyBoardProject>>,
  discoveries: readonly DiscoveredProject[],
  options: ProjectRegistryMigrationOptions = {},
): Promise<ProjectRegistryV1> {
  return updateProjectRegistry(async (registry) => {
    const now = currentIso(options);
    const preexisting = new Set(Object.keys(registry.projects));
    for (const discovery of discoveries) applyDiscovery(registry, discovery, now);
    if (registry.migratedFromBoardAt) return;

    await backupBoardBeforeMigration(options, now);
    for (const project of Object.values(registry.projects)) {
      const entries: LegacyBoardProject[] = [];
      for (const providerRef of project.providerRefs.claude) {
        const legacyKey = Object.prototype.hasOwnProperty.call(legacyProjects, `claude:${providerRef}`)
          ? `claude:${providerRef}`
          : providerRef;
        if (Object.prototype.hasOwnProperty.call(legacyProjects, legacyKey)) {
          entries.push(legacyProjects[legacyKey]);
        }
      }
      for (const providerRef of project.providerRefs.codex) {
        if (Object.prototype.hasOwnProperty.call(legacyProjects, providerRef)) {
          entries.push(legacyProjects[providerRef]);
        }
      }
      if (entries.length === 0) continue;

      const displayName = firstText(entries, (entry) => entry.nameOverride);
      const memo = firstText(entries, (entry) => entry.memo);
      const tracks = firstTracks(entries);
      const order = firstOrder(entries);
      const correctedRoot = firstText(entries, (entry) => entry.repoPath);
      const status = leastArchivedStatus(entries);
      const hidden = entries.every((entry) => entry.hidden === true);
      const existed = preexisting.has(project.id);
      if (!existed || project.displayName === null) project.displayName = displayName;
      if (!existed || project.status === null) project.status = status;
      if (!existed || project.memo === "") project.memo = memo ?? "";
      if (!existed || project.tracks.length === 0) project.tracks = tracks ?? [];
      if (!existed || !project.hidden) project.hidden = hidden;
      if (!existed || project.order === null) project.order = order;
      if (!existed && correctedRoot) project.rootPath = resolvedProjectPath(correctedRoot);
      project.updatedAt = now;
    }
    registry.migratedFromBoardAt = now;
  }, options);
}

function sharedProjectToBoardEntry(project: SharedProject): ProjectBoardEntry {
  const entry: ProjectBoardEntry = { repoPath: project.rootPath };
  if (project.status) entry.status = project.status;
  if (project.memo) entry.memo = project.memo;
  if (project.displayName) entry.nameOverride = project.displayName;
  if (project.tracks.length > 0) entry.tracks = structuredClone(project.tracks);
  if (project.hidden) entry.hidden = true;
  if (project.order !== null) entry.order = project.order;
  return entry;
}

export function overlayProjectRegistryOnBoard(
  board: BoardData,
  registry: ProjectRegistryV1,
): BoardData {
  const projects = { ...board.projects };
  for (const project of Object.values(registry.projects)) {
    for (const providerRef of project.providerRefs.claude) {
      projects[`claude:${providerRef}`] = sharedProjectToBoardEntry(project);
    }
    for (const providerRef of project.providerRefs.codex) projects[providerRef] = sharedProjectToBoardEntry(project);
  }
  return { ...board, projects };
}

/** Read-only composition; malformed registries leave the legacy board available without rewriting it. */
export async function readBoardWithProjectRegistry(): Promise<BoardData> {
  const board = await readBoard();
  try {
    return overlayProjectRegistryOnBoard(board, await readProjectRegistry());
  } catch {
    return board;
  }
}

function projectMatchesIdentifier(project: SharedProject, identifier: string): boolean {
  const claudeRef = identifier.startsWith("claude:") ? identifier.slice("claude:".length) : identifier;
  const codexRef = identifier.startsWith("codex:") ? identifier : `codex:${identifier}`;
  return (
    project.id === identifier ||
    project.providerRefs.claude.includes(claudeRef) ||
    project.providerRefs.codex.includes(codexRef)
  );
}

export function findProjectRegistryProject(
  registry: ProjectRegistryV1,
  identifiers: readonly string[],
  rootPath?: string | null,
): SharedProject | null {
  const projects = Object.values(registry.projects);
  if (rootPath) {
    const rootKey = normalizeProjectPath(rootPath);
    const byPath = projects.find((project) => normalizeProjectPath(project.rootPath) === rootKey);
    if (byPath) return byPath;
  }
  return (
    projects.find((project) =>
      identifiers.some((identifier) => projectMatchesIdentifier(project, identifier)),
    ) ?? null
  );
}

function applyRegistryPatch(project: SharedProject, patch: RegistryProjectPatch, now: string): void {
  if (patch.status !== undefined && PROJECT_STATUSES.has(patch.status as ProjectStatus)) {
    project.status = patch.status as ProjectStatus;
  }
  if (patch.memo !== undefined) project.memo = patch.memo;
  if (patch.nameOverride !== undefined) project.displayName = patch.nameOverride?.trim() || null;
  if (patch.tracks !== undefined) {
    validateTracks(patch.tracks, "project patch.tracks");
    project.tracks = structuredClone(patch.tracks);
  }
  if (typeof patch.repoPath === "string" && patch.repoPath.trim()) {
    project.rootPath = resolvedProjectPath(patch.repoPath);
  }
  if (patch.hidden !== undefined) project.hidden = patch.hidden;
  if (patch.order !== undefined) {
    project.order =
      typeof patch.order === "number" && Number.isInteger(patch.order) && patch.order >= 0
        ? patch.order
        : null;
  }
  project.updatedAt = now;
}

export async function setRegistryProjectsField(
  ids: readonly string[],
  patch: RegistryProjectPatch,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryV1> {
  const identifiers = [...new Set(ids.filter(Boolean))];
  return updateProjectRegistry((registry) => {
    const matches = Object.values(registry.projects).filter((project) =>
      identifiers.some((identifier) => projectMatchesIdentifier(project, identifier)),
    );
    if (matches.length === 0) throw new ProjectRegistryProjectNotFoundError(identifiers);
    const now = currentIso(options);
    for (const project of matches) applyRegistryPatch(project, patch, now);
  }, options);
}

export async function setRegistryProjectField(
  id: string,
  patch: RegistryProjectPatch,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryV1> {
  return setRegistryProjectsField([id], patch, options);
}

export async function setRegistryProjectsOrder(
  orders: Readonly<Record<string, number>>,
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryV1> {
  return updateProjectRegistry((registry) => {
    const now = currentIso(options);
    for (const [identifier, order] of Object.entries(orders)) {
      if (!Number.isInteger(order) || order < 0) continue;
      for (const project of Object.values(registry.projects)) {
        if (!projectMatchesIdentifier(project, identifier)) continue;
        project.order = order;
        project.updatedAt = now;
      }
    }
  }, options);
}

export async function setRegistryProjectsVisibility(
  ids: readonly string[],
  patch: { hidden?: boolean; status?: string },
  options: ProjectRegistryOptions = {},
): Promise<ProjectRegistryV1> {
  return setRegistryProjectsField(ids, patch, options);
}

export type {
  ProjectRegistryV1,
  ProjectSource,
  ProjectStatus,
  SharedProject,
  SharedProjectTrack,
} from "@shared/project-registry";
