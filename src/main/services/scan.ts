import fs from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOME, STALE_DAYS, TEMP_DIRS, AGENT_SIZE_WARN_BYTES } from "../config.js";
import { getProjects } from "./projects.js";

export interface CleanupCandidate {
  path: string;
  category: string; // archive 하위 디렉토리명
  reason: string;
  size: number;
  ageDays: number;
}

/** 규칙 기반 정리 후보 스캔. 결과는 후보일 뿐 — 실행은 dry-run 검토 후. */
export async function scanCandidates(): Promise<CleanupCandidate[]> {
  const out: CleanupCandidate[] = [];
  const cutoff = Date.now() - STALE_DAYS * 86400000;

  // 1) 임시 디렉토리의 30일+ 파일
  for (const dirName of TEMP_DIRS) {
    const dir = path.join(CLAUDE_HOME, dirName);
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile()) continue;
      const p = path.join(dir, entry.name);
      const stat = await fs.stat(p).catch(() => null);
      if (!stat || stat.mtimeMs >= cutoff) continue;
      out.push({
        path: p,
        category: `temp/${dirName}`,
        reason: `temp ${dirName} ${STALE_DAYS}일 초과`,
        size: stat.size,
        ageDays: Math.floor((Date.now() - stat.mtimeMs) / 86400000),
      });
    }
  }

  // 2) stale 프로젝트 디렉토리 (메모리 포함 전체)
  for (const proj of await getProjects()) {
    if (proj.staleDays < STALE_DAYS) continue;
    out.push({
      path: path.join(CLAUDE_HOME, "projects", proj.id),
      category: "projects",
      reason: `프로젝트 비활성 ${proj.staleDays}일 (트랜스크립트 ${proj.transcriptCount}, 메모리 ${proj.memoryFileCount})`,
      size: proj.size,
      ageDays: proj.staleDays,
    });
  }

  // 3) 대형 에이전트 파일 (경고만 — 이동 후보 아님, UI 표시용)
  const agentsDir = path.join(CLAUDE_HOME, "agents");
  for (const entry of await fs.readdir(agentsDir).catch(() => [])) {
    if (!entry.endsWith(".md")) continue;
    const p = path.join(agentsDir, entry);
    const stat = await fs.stat(p).catch(() => null);
    if (!stat) continue; // readdir 후 삭제된 파일
    if (stat.size > AGENT_SIZE_WARN_BYTES) {
      out.push({
        path: p,
        category: "warn-only",
        reason: `에이전트 파일 19KB 초과 — 압축 검토 (이동 비권장)`,
        size: stat.size,
        ageDays: Math.floor((Date.now() - stat.mtimeMs) / 86400000),
      });
    }
  }

  return out;
}
