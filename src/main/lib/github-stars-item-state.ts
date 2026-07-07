import fs from "node:fs/promises";
import path from "node:path";
import { GITHUB_STARS_ITEM_STATE_FILE } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";
import type { ItemStateMap, ItemInteractionState } from "@shared/types";

/**
 * 레포별 "읽음 시각 + 숨김" 상태 저장소. news-item-state.ts와 완전히 독립된 파일(News/GitHub Stars
 * 완전 독립 원칙)이나 로직은 동일 — 키만 id 대신 fullName("owner/repo"). 잦은 쓰기라 .bak 없음.
 */

interface ItemStateData {
  version: 1;
  items: ItemStateMap;
}

function emptyState(): ItemStateData {
  return { version: 1, items: {} };
}

function sanitizeEntry(raw: unknown): ItemInteractionState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const entry: ItemInteractionState = {};
  if (typeof r.lastReadAt === "number" && Number.isFinite(r.lastReadAt)) entry.lastReadAt = r.lastReadAt;
  if (r.hidden === true) entry.hidden = true;
  return Object.keys(entry).length ? entry : null;
}

function sanitize(parsed: unknown): ItemStateData {
  const data = emptyState();
  if (!parsed || typeof parsed !== "object") return data;
  const p = parsed as Record<string, unknown>;
  if (p.items && typeof p.items === "object") {
    for (const [fullName, v] of Object.entries(p.items as Record<string, unknown>)) {
      const entry = sanitizeEntry(v);
      if (entry) data.items[fullName] = entry;
    }
  }
  return data;
}

async function readState(): Promise<ItemStateData> {
  const p = guardPath(GITHUB_STARS_ITEM_STATE_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
    throw e;
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${GITHUB_STARS_ITEM_STATE_FILE}.corrupt.${stamp}`)).catch(() => {});
    return emptyState();
  }
}

async function writeStateAtomic(data: ItemStateData) {
  const p = guardPath(GITHUB_STARS_ITEM_STATE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tempPath = p + ".chm-tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, p);
}

/** 전체 상태 맵(fullName → 읽음시각/숨김). */
export async function getGitHubStarsItemState(): Promise<ItemStateMap> {
  const data = await readState();
  return data.items;
}

/** 지금 시각으로 읽음 표시. 갱신된 전체 맵을 반환(renderer 재동기화용). */
export async function markGitHubStarsRead(fullName: string): Promise<ItemStateMap> {
  return withLock(async () => {
    const data = await readState();
    data.items[fullName] = { ...data.items[fullName], lastReadAt: Date.now() };
    await writeStateAtomic(data);
    return data.items;
  });
}

/** 숨김 토글. hidden=false면 필드를 지우고, 항목이 완전히 비면 키 자체를 지운다. */
export async function setGitHubStarsHidden(fullName: string, hidden: boolean): Promise<ItemStateMap> {
  return withLock(async () => {
    const data = await readState();
    if (hidden) {
      data.items[fullName] = { ...data.items[fullName], hidden: true };
    } else if (data.items[fullName]) {
      const { hidden: _drop, ...rest } = data.items[fullName];
      if (Object.keys(rest).length) data.items[fullName] = rest;
      else delete data.items[fullName];
    }
    await writeStateAtomic(data);
    return data.items;
  });
}
