import fs from "node:fs/promises";
import path from "node:path";
import { NEWS_ITEM_STATE_FILE } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";
import type { ItemStateMap, ItemInteractionState } from "@shared/types";

/**
 * 기사별 "읽음 시각 + 숨김" 상태 저장소. github-stars-favorites.ts와 같은 앱 소유 파일 패턴
 * (guardPath + withLock 직렬화 + atomic temp/rename)이나, 기사를 열 때마다 발생하는 잦은 쓰기라
 * .bak 백업은 생략한다(즐겨찾기와 달리 유실 시 재구성 부담이 낮은 상호작용 로그).
 * 손상 시 손상본을 옆에 두고 빈 맵으로 생존한다(페이지가 죽지 않게).
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
    for (const [id, v] of Object.entries(p.items as Record<string, unknown>)) {
      const entry = sanitizeEntry(v);
      if (entry) data.items[id] = entry;
    }
  }
  return data;
}

async function readState(): Promise<ItemStateData> {
  const p = guardPath(NEWS_ITEM_STATE_FILE);
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
    // 손상본은 옆에 보관하고 기본값으로 생존
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${NEWS_ITEM_STATE_FILE}.corrupt.${stamp}`)).catch(() => {});
    return emptyState();
  }
}

async function writeStateAtomic(data: ItemStateData) {
  const p = guardPath(NEWS_ITEM_STATE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tempPath = p + ".chm-tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, p);
}

/** 전체 상태 맵(id → 읽음시각/숨김). */
export async function getNewsItemState(): Promise<ItemStateMap> {
  const data = await readState();
  return data.items;
}

/** 지금 시각으로 읽음 표시. 갱신된 전체 맵을 반환(renderer 재동기화용). */
export async function markNewsRead(id: string): Promise<ItemStateMap> {
  return withLock(async () => {
    const data = await readState();
    data.items[id] = { ...data.items[id], lastReadAt: Date.now() };
    await writeStateAtomic(data);
    return data.items;
  });
}

/** 숨김 토글. hidden=false면 필드를 지우고, 항목이 완전히 비면 키 자체를 지운다. */
export async function setNewsHidden(id: string, hidden: boolean): Promise<ItemStateMap> {
  return withLock(async () => {
    const data = await readState();
    if (hidden) {
      data.items[id] = { ...data.items[id], hidden: true };
    } else if (data.items[id]) {
      const { hidden: _drop, ...rest } = data.items[id];
      if (Object.keys(rest).length) data.items[id] = rest;
      else delete data.items[id];
    }
    await writeStateAtomic(data);
    return data.items;
  });
}
