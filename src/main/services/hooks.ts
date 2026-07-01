import fs from "node:fs/promises";
import { STAMP_PLAN_SESSION_HOOK_FILE } from "../config.js";
import { guardPath } from "../lib/path-guard.js";

/**
 * 세션→계획 연결 hook(stamp-plan-session.mjs) 원문을 읽는다.
 * 다른 PC 설치용 프롬프트를 만들 때(ConfigEditor) 쓰인다. 이 PC에 훅이 없으면 그대로 던진다
 * (호출부인 router가 404로 변환).
 */
export async function readStampPlanSessionHook(): Promise<string> {
  const p = guardPath(STAMP_PLAN_SESSION_HOOK_FILE);
  return fs.readFile(p, "utf8");
}
