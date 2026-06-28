import fs from "node:fs/promises";
import { guardPath } from "./path-guard.js";
import {
  GLOSSARY_CUSTOM_FILE,
  GLOSSARY_CUSTOM_MAX_DOMAINS,
  GLOSSARY_CUSTOM_MAX_SUBCATS,
  GLOSSARY_CUSTOM_MAX_TERMS,
  GLOSSARY_CUSTOM_LABEL_MAX,
  GLOSSARY_CUSTOM_DEF_MAX,
} from "../config.js";
import type {
  CustomGlossaryData,
  CustomGlossaryDomain,
  CustomGlossaryResponse,
  CustomGlossaryTerm,
} from "@shared/types";

// 커스텀 용어집은 사용자/CC가 채우는 파일이라 앱은 읽기 전용 + 신뢰 불가 → 화이트리스트 sanitize.
// 없음(ENOENT)·손상에도 빈 값으로 생존(board.ts/news-cache.ts와 동일 철학). 쓰기·락·백업 없음.

function empty(): CustomGlossaryData {
  return { version: 1, domains: [], terms: [] };
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

function sanitize(parsed: unknown): CustomGlossaryData {
  const out = empty();
  if (!parsed || typeof parsed !== "object") return out;
  const p = parsed as Record<string, unknown>;

  const domainIds = new Set<string>();
  const subcatKeys = new Set<string>(); // `${domainId}:${subcatId}` — term 참조 검증용
  if (Array.isArray(p.domains)) {
    for (const raw of p.domains) {
      if (out.domains.length >= GLOSSARY_CUSTOM_MAX_DOMAINS) break;
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const id = asStr(r.id);
      const label = asStr(r.label);
      if (!id || !label || domainIds.has(id)) continue;
      const subcats: CustomGlossaryDomain["subcats"] = [];
      const localSub = new Set<string>();
      if (Array.isArray(r.subcats)) {
        for (const sraw of r.subcats) {
          if (subcats.length >= GLOSSARY_CUSTOM_MAX_SUBCATS) break;
          if (!sraw || typeof sraw !== "object") continue;
          const sr = sraw as Record<string, unknown>;
          const sid = asStr(sr.id);
          const slabel = asStr(sr.label);
          if (!sid || !slabel || localSub.has(sid)) continue;
          localSub.add(sid);
          subcats.push({ id: sid, label: clip(slabel, GLOSSARY_CUSTOM_LABEL_MAX) });
          subcatKeys.add(`${id}:${sid}`);
        }
      }
      if (subcats.length === 0) continue; // 소분류 없는 도메인은 용어를 둘 곳 없음 → drop
      domainIds.add(id);
      out.domains.push({ id, label: clip(label, GLOSSARY_CUSTOM_LABEL_MAX), subcats });
    }
  }

  if (Array.isArray(p.terms)) {
    for (const raw of p.terms) {
      if (out.terms.length >= GLOSSARY_CUSTOM_MAX_TERMS) break;
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const term = asStr(r.term);
      const termKo = asStr(r.termKo);
      const definition = asStr(r.definition);
      const domain = asStr(r.domain);
      const subcat = asStr(r.subcat);
      if (!term || !termKo || !definition || !domain || !subcat) continue;
      if (!subcatKeys.has(`${domain}:${subcat}`)) continue; // 미정의 분류 참조 → drop
      const t: CustomGlossaryTerm = {
        term,
        termKo,
        domain,
        subcat,
        definition: clip(definition, GLOSSARY_CUSTOM_DEF_MAX),
      };
      if (Array.isArray(r.aliases)) {
        const al = r.aliases.filter((a): a is string => typeof a === "string" && Boolean(a.trim()));
        if (al.length) t.aliases = al;
      }
      const ex = asStr(r.example);
      if (ex) t.example = clip(ex, GLOSSARY_CUSTOM_DEF_MAX);
      out.terms.push(t);
    }
  }

  return out;
}

export async function readCustomGlossary(): Promise<CustomGlossaryResponse> {
  const p = guardPath(GLOSSARY_CUSTOM_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { data: empty(), path: p, exists: false };
    }
    throw e;
  }
  try {
    return { data: sanitize(JSON.parse(raw)), path: p, exists: true };
  } catch {
    // 손상본은 옆에 보관하고 빈 값으로 생존(페이지가 죽지 않게) — board.ts와 동일.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${GLOSSARY_CUSTOM_FILE}.corrupt.${stamp}`)).catch(() => {});
    return { data: empty(), path: p, exists: true };
  }
}
