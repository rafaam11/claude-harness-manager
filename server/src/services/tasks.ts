import fs from "node:fs/promises";
import path from "node:path";
import { TASKS_DIR } from "../config.js";
import { guardPath } from "../lib/path-guard.js";

/**
 * ~/.claude/tasks/<sessionId>/<n>.json 의 세션별 TodoWrite 항목을 읽는다(읽기 전용).
 * "마지막 세션에서 X/Y 완료" 회상 표시에 쓴다.
 */
export interface TodoLite {
  id: string;
  subject: string;
  status: string;
}
export interface SessionTodos {
  total: number;
  done: number;
  items: TodoLite[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSessionTodos(sessionId: string): Promise<SessionTodos | null> {
  if (!UUID_RE.test(sessionId)) return null;
  const dir = guardPath(path.join(TASKS_DIR, sessionId));
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;

  const items: TodoLite[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue; // .lock 등 제외
    try {
      const o = JSON.parse(await fs.readFile(path.join(dir, e.name), "utf8"));
      if (o && typeof o.subject === "string") {
        items.push({
          id: String(o.id ?? e.name.replace(/\.json$/, "")),
          subject: o.subject,
          status: String(o.status ?? "pending"),
        });
      }
    } catch {
      /* 깨진 항목은 건너뛴다 */
    }
  }
  if (items.length === 0) return null;

  items.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0)); // 1.json, 2.json …
  const done = items.filter((i) => i.status === "completed").length;
  return { total: items.length, done, items };
}
