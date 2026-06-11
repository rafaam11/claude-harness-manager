# 카탈로그 블럭화 + MCP 서버 (1단계) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) 또는 superpowers:executing-plans 로 task 단위 실행. 스텝은 `- [ ]` 체크박스로 추적.

**Goal:** Catalog 화면을 종류별 그룹 + 카드 블럭 + 인라인 확장(프론트매터 표 · 마크다운 본문)으로 바꾸고, MCP 서버를 같은 화면에 읽기 전용으로 통합한다.

**Architecture:** 백엔드에 읽기 전용 엔드포인트 2개(카탈로그 본문 조회, MCP 목록)를 추가하고, 프론트 `Catalog.tsx`를 테이블에서 블럭+아코디언으로 재작성한다. 본문은 `marked`로 렌더. **1단계 전체가 읽기 전용 — 쓰기 라우트·safe-write·archive 경로는 건드리지 않는다.**

**Tech Stack:** Fastify 5 + TS ESM(NodeNext, 상대 임포트 `.js` 확장자 필수) · React 18 + Vite 6 · gray-matter(기존) · marked(신규)

**설계 출처:** `docs/superpowers/specs/2026-06-11-catalog-blocks-mcp-design.md`

**검증 방식(프로젝트 특성):** 이 저장소는 단위 테스트 프레임워크가 없고 git repo도 아니다. 따라서 각 Task의 검증은 **`npm run typecheck`(1차 관문) + dev 서버 수동 확인 + `python e2e-check.py` 스모크**로 한다. TDD의 "failing test" 단계와 커밋 단계는 생략한다(사용자가 커밋을 명시 지시하면 그때 일괄 커밋).

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `server/src/services/catalog.ts` | 카탈로그 메타 + **본문/프론트매터 조회** 함수 | 수정(함수 추가) |
| `server/src/services/mcp.ts` | `~/.claude.json`의 mcpServers 파싱(읽기) | **신규** |
| `server/src/routes/index.ts` | HTTP 라우트 등록 | 수정(읽기 라우트 2개 추가) |
| `web/package.json` | marked 의존성 | 수정 |
| `web/src/pages/Catalog.tsx` | 블럭 리스트 + 인라인 상세 + MCP | 재작성 |
| `web/src/index.css` | 블럭/상세/배지/시크릿 스타일 | 수정(클래스 추가) |

> 플러그인 테이블은 1단계 범위 밖이다. `Catalog.tsx` 재작성 시 **기존 플러그인 표는 그대로 보존**한다(섹션 하나로 유지).

---

## Task 1: 백엔드 — 카탈로그 본문 조회 API (읽기 전용)

**Files:**
- Modify: `server/src/services/catalog.ts` (import 추가, 함수 추가)
- Modify: `server/src/routes/index.ts` (import 1줄, 라우트 1개)

- [ ] **Step 1: `catalog.ts`에 guardPath import 추가**

파일 상단 import 블록(현재 `../config.js` 까지)에 한 줄 추가:

```ts
import { CLAUDE_HOME, AGENT_SIZE_WARN_BYTES } from "../config.js";
import { guardPath } from "../lib/path-guard.js";
```

- [ ] **Step 2: `catalog.ts` 끝에 본문 조회 함수와 타입 추가**

`getCatalog()` 함수 아래(파일 끝)에 추가. truncate 패턴은 `services/projects.ts:92-104`의 `readProjectFile`과 동일하게 맞춘다:

```ts
export interface CatalogContent {
  raw: string; // frontmatter를 제외한 본문(마크다운)
  frontmatter: Record<string, unknown>;
  size: number;
  mtime: number;
  truncated: boolean;
}

/**
 * 카탈로그 항목(skill/agent/command md) 파일의 본문과 프론트매터를 읽는다.
 * 경로는 반드시 guardPath를 통과해야 한다(~/.claude 밖이면 PathViolationError → 403).
 */
export async function readCatalogContent(filePath: string): Promise<CatalogContent> {
  const p = guardPath(filePath);
  const stat = await fs.stat(p);
  let text: string;
  let truncated = false;
  if (stat.size > 2 * 1024 * 1024) {
    const fh = await fs.open(p, "r");
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    text = buf.toString("utf8", 0, bytesRead);
    truncated = true;
  } else {
    text = await fs.readFile(p, "utf8");
  }
  const fm = matter(text);
  return {
    raw: fm.content,
    frontmatter: (fm.data ?? {}) as Record<string, unknown>,
    size: stat.size,
    mtime: stat.mtimeMs,
    truncated,
  };
}
```

- [ ] **Step 3: `routes/index.ts`에 import와 라우트 추가**

import 변경(8번째 줄 `getCatalog` 옆):

```ts
import { getCatalog, readCatalogContent } from "../services/catalog.js";
```

`app.get("/api/catalog", ...)` 줄(현재 87번째) 바로 아래에 추가:

```ts
  app.get("/api/catalog/content", async (req, reply) => {
    const { path: filePath } = req.query as { path?: string };
    if (!filePath) return reply.code(400).send({ error: "path 필요" });
    return readCatalogContent(filePath);
  });
```

> guardPath가 던지는 `PathViolationError`는 `statusCode = 403`을 가지므로 `index.ts`의 statusCode 기반 에러 핸들러가 그대로 403으로 응답한다(추가 처리 불필요).

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: 에러 없이 통과(server + web).

- [ ] **Step 5: 수동 확인 (dev 서버가 떠 있을 때)**

PowerShell:
```
Invoke-RestMethod "http://127.0.0.1:7860/api/catalog/content?path=$([uri]::EscapeDataString((Invoke-RestMethod 'http://127.0.0.1:7860/api/catalog')[0].path))"
```
Expected: `raw`, `frontmatter`, `size`, `mtime`, `truncated` 필드가 있는 객체. 잘못된 경로(`?path=C:\Windows\win.ini`)는 403.

---

## Task 2: 백엔드 — MCP 서비스 + API (읽기 전용)

**Files:**
- Create: `server/src/services/mcp.ts`
- Modify: `server/src/routes/index.ts` (import 1줄, 라우트 1개)

- [ ] **Step 1: `server/src/services/mcp.ts` 생성**

`~/.claude.json`을 읽어 mcpServers 정의를 수집한다. 사용자 스코프(최상위 `mcpServers`)와 프로젝트 스코프(`projects.<path>.mcpServers`)를 **둘 다 수용**한다(실제 저장 위치는 환경마다 다를 수 있음 — 설계 §미해결 3).

```ts
import fs from "node:fs/promises";
import { CLAUDE_JSON } from "../config.js";

export interface McpServer {
  name: string;
  scope: "user" | "project";
  projectPath?: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function toServer(
  name: string,
  def: Record<string, unknown>,
  scope: "user" | "project",
  projectPath?: string,
): McpServer {
  const type = def.type as string | undefined;
  let transport: McpServer["transport"] = "unknown";
  if (type === "stdio" || type === "http" || type === "sse") transport = type;
  else if (def.command) transport = "stdio";
  else if (def.url) transport = "http";
  return {
    name,
    scope,
    projectPath,
    transport,
    command: def.command as string | undefined,
    args: Array.isArray(def.args) ? (def.args as string[]) : undefined,
    env: (def.env as Record<string, string> | undefined) ?? undefined,
    url: def.url as string | undefined,
    headers: (def.headers as Record<string, string> | undefined) ?? undefined,
  };
}

/** ~/.claude.json은 읽기만 한다(읽기 전용 정책 불변). */
export async function getMcpServers(): Promise<McpServer[]> {
  const raw = await fs.readFile(CLAUDE_JSON, "utf8").catch(() => null);
  if (!raw) return [];
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: McpServer[] = [];

  const top = json.mcpServers as Record<string, Record<string, unknown>> | undefined;
  for (const [name, def] of Object.entries(top ?? {})) {
    out.push(toServer(name, def, "user"));
  }

  const projects = json.projects as Record<string, { mcpServers?: Record<string, Record<string, unknown>> }> | undefined;
  for (const [projectPath, pdata] of Object.entries(projects ?? {})) {
    for (const [name, def] of Object.entries(pdata.mcpServers ?? {})) {
      out.push(toServer(name, def, "project", projectPath));
    }
  }
  return out;
}
```

- [ ] **Step 2: `routes/index.ts`에 import와 라우트 추가**

import 추가(services 묶음 근처, 11번째 줄 `scan` import 아래):

```ts
import { getMcpServers } from "../services/mcp.js";
```

`app.get("/api/projects", ...)` 줄(현재 89번째) 아래에 추가:

```ts
  app.get("/api/mcp", async () => getMcpServers());
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: 통과.

- [ ] **Step 4: 수동 확인**

PowerShell: `Invoke-RestMethod "http://127.0.0.1:7860/api/mcp"`
Expected: 배열(없으면 `[]`). 항목이 있으면 `name`, `scope`, `transport`, 그리고 stdio는 `command`/`args`/`env`, http는 `url`/`headers`를 가짐. **에러 없이 빈 배열이어도 정상**(이 환경에 MCP 정의가 없을 수 있음).

---

## Task 3: 프론트 — marked 의존성 추가

**Files:**
- Modify: `web/package.json`

- [ ] **Step 1: dependencies에 marked 추가**

`web/package.json`의 `dependencies`를 다음으로 교체:

```json
  "dependencies": {
    "marked": "^15.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
```

- [ ] **Step 2: 설치**

Run(루트에서): `npm install`
Expected: marked가 `web`에 설치됨. (marked는 자체 타입을 동봉하므로 `@types/marked` 불필요.)

> 보안 메모: 본문 입력은 **사용자 자신의 `~/.claude` 파일**이라 신뢰 입력으로 본다. 127.0.0.1 로컬 단독 앱 전제이므로 DOMPurify 같은 추가 sanitize는 도입하지 않는다(YAGNI). 이 트레이드오프는 설계 문서 §보안 노트에 기록됨.

---

## Task 4: 프론트 — Catalog.tsx 재작성

**Files:**
- Modify: `web/src/pages/Catalog.tsx` (전체 재작성)

- [ ] **Step 1: `Catalog.tsx`를 아래 전체 코드로 교체**

종류별 4섹션(Skills/Agents/Commands/MCP) + 카드 + 단일 인라인 확장. 카탈로그 카드는 클릭 시 본문 lazy 로드(`/api/catalog/content`). MCP는 연결 설정 표 + 시크릿 마스킹/보기 토글. 플러그인 표는 기존 그대로 보존.

```tsx
import { useEffect, useState } from "react";
import { marked } from "marked";
import { api, fmtSize, fmtDate } from "../api/client";

interface CatalogItem {
  name: string;
  kind: "skill" | "agent" | "command";
  description: string;
  path: string;
  size: number;
  mtime: number;
  warn?: string;
}

interface PluginInfo {
  id: string;
  enabledInSettings: boolean | null;
  installs: { scope: string; projectPath?: string; version: string }[];
  blocked: boolean;
}

interface McpServer {
  name: string;
  scope: "user" | "project";
  projectPath?: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface CatalogContent {
  raw: string;
  frontmatter: Record<string, unknown>;
  size: number;
  mtime: number;
  truncated: boolean;
}

const KIND_LABEL: Record<CatalogItem["kind"], string> = {
  skill: "Skills",
  agent: "Agents",
  command: "Commands",
};
const KIND_BADGE: Record<CatalogItem["kind"], string> = {
  skill: "SKILL",
  agent: "AGENT",
  command: "CMD",
};

export default function Catalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [mcps, setMcps] = useState<McpServer[]>([]);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, CatalogContent>>({});

  useEffect(() => {
    api.get<CatalogItem[]>("/api/catalog").then(setItems).catch((e) => setError(e.message));
    api
      .get<{ plugins: PluginInfo[] }>("/api/plugins")
      .then((d) => setPlugins(d.plugins))
      .catch((e) => setError(e.message));
    api.get<McpServer[]>("/api/mcp").then(setMcps).catch((e) => setError(e.message));
  }, []);

  async function toggleItem(it: CatalogItem) {
    const key = `item:${it.path}`;
    if (openKey === key) {
      setOpenKey(null);
      return;
    }
    setOpenKey(key);
    if (!content[it.path]) {
      try {
        const c = await api.get<CatalogContent>(
          `/api/catalog/content?path=${encodeURIComponent(it.path)}`,
        );
        setContent((prev) => ({ ...prev, [it.path]: c }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  const byKind = (kind: CatalogItem["kind"]) => items.filter((i) => i.kind === kind);

  return (
    <div>
      <h2>Catalog</h2>
      {error && <div className="banner err">{error}</div>}

      {(["skill", "agent", "command"] as const).map((kind) => (
        <section className="cat-section" key={kind}>
          <h3>
            {KIND_LABEL[kind]} <span className="cat-count">{byKind(kind).length}</span>
          </h3>
          <div className="cat-grid">
            {byKind(kind).map((it) => {
              const open = openKey === `item:${it.path}`;
              return (
                <div className={`cat-card${open ? " expanded" : ""}`} key={it.path}>
                  <button className="cat-card-head" onClick={() => toggleItem(it)}>
                    <span className={`bdg bdg-${kind}`}>{KIND_BADGE[kind]}</span>
                    <span className="cat-name">{it.name}</span>
                    {it.warn && <span className="tag warn">⚠</span>}
                    <span className="cat-chev">{open ? "▴" : "▾"}</span>
                    <div className="cat-desc">{it.description}</div>
                    <div className="cat-meta">
                      {fmtSize(it.size)} · {fmtDate(it.mtime)}
                    </div>
                  </button>
                  {open && <ItemDetail it={it} data={content[it.path]} />}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <section className="cat-section">
        <h3>
          MCP Servers <span className="cat-count">{mcps.length}</span>
        </h3>
        <div className="cat-grid">
          {mcps.map((m) => {
            const key = `mcp:${m.scope}:${m.projectPath ?? ""}:${m.name}`;
            const open = openKey === key;
            return (
              <div className={`cat-card${open ? " expanded" : ""}`} key={key}>
                <button className="cat-card-head" onClick={() => setOpenKey(open ? null : key)}>
                  <span className="bdg bdg-mcp">MCP</span>
                  <span className="cat-name">{m.name}</span>
                  <span className="t-tag">{m.transport}</span>
                  <span className="cat-chev">{open ? "▴" : "▾"}</span>
                  <div className="cat-desc">
                    {m.scope === "project" ? `project: ${m.projectPath}` : "user scope"}
                  </div>
                </button>
                {open && <McpDetail m={m} />}
              </div>
            );
          })}
          {mcps.length === 0 && <div className="muted">정의된 MCP 서버가 없습니다.</div>}
        </div>
      </section>

      <section className="cat-section">
        <h3>
          플러그인 <span className="cat-count">{plugins.length}</span>
        </h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>활성</th>
              <th>설치</th>
            </tr>
          </thead>
          <tbody>
            {plugins.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td>
                  {p.enabledInSettings === true && <span className="tag ok">enabled</span>}
                  {p.enabledInSettings === false && <span className="tag warn">disabled</span>}
                  {p.enabledInSettings === null && <span className="tag muted">project</span>}
                  {p.blocked && <span className="tag warn"> blocked</span>}
                </td>
                <td className="muted">
                  {p.installs
                    .map((i) => `${i.scope}${i.projectPath ? ` (${i.projectPath})` : ""} v${i.version}`)
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function ItemDetail({ it, data }: { it: CatalogItem; data?: CatalogContent }) {
  if (!data) return <div className="cat-detail muted">불러오는 중…</div>;
  const fm = data.frontmatter ?? {};
  const fmKeys = Object.keys(fm);
  return (
    <div className="cat-detail">
      <div className="cat-path mono">{it.path}</div>
      <div className="cat-detail-meta">
        {fmtSize(data.size)} · 수정 {fmtDate(data.mtime)}
        {data.truncated && " · (대형 파일 일부만 표시)"}
      </div>
      {fmKeys.length > 0 && (
        <div className="fm-table">
          <div className="sec-label">Frontmatter</div>
          {fmKeys.map((k) => {
            const v = fm[k];
            const text = Array.isArray(v)
              ? v.join(", ")
              : typeof v === "object" && v !== null
                ? JSON.stringify(v)
                : String(v);
            return (
              <div className="fm-row" key={k}>
                <span className="fm-k">{k}</span>
                <span className="fm-v mono">{text}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="sec-label">본문</div>
      <div
        className="md-body"
        dangerouslySetInnerHTML={{ __html: marked.parse(data.raw) as string }}
      />
    </div>
  );
}

function McpDetail({ m }: { m: McpServer }) {
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const secretRow = (k: string, v: string) => (
    <div className="fm-row" key={k}>
      <span className="fm-k">{k}</span>
      <span className="fm-v mono">{reveal[k] ? v : "••••••••••••"}</span>
      <button className="eye" onClick={() => setReveal((p) => ({ ...p, [k]: !p[k] }))}>
        {reveal[k] ? "🙈" : "👁"}
      </button>
    </div>
  );
  return (
    <div className="cat-detail">
      <div className="cat-path mono">
        ~/.claude.json · {m.scope === "project" ? m.projectPath : "user scope"}
      </div>
      <div className="sec-label">연결</div>
      {m.command && (
        <div className="fm-row">
          <span className="fm-k">command</span>
          <span className="fm-v mono">{m.command}</span>
        </div>
      )}
      {m.args && (
        <div className="fm-row">
          <span className="fm-k">args</span>
          <span className="fm-v mono">{m.args.join(" ")}</span>
        </div>
      )}
      {m.url && (
        <div className="fm-row">
          <span className="fm-k">url</span>
          <span className="fm-v mono">{m.url}</span>
        </div>
      )}
      {m.env && Object.keys(m.env).length > 0 && (
        <>
          <div className="sec-label">env</div>
          {Object.entries(m.env).map(([k, v]) => secretRow(k, String(v)))}
        </>
      )}
      {m.headers && Object.keys(m.headers).length > 0 && (
        <>
          <div className="sec-label">headers</div>
          {Object.entries(m.headers).map(([k, v]) => secretRow(k, String(v)))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 통과. (marked의 `parse`는 `string | Promise<string>` 유니온이라 `as string` 캐스팅이 필요 — 코드에 이미 포함.)

---

## Task 5: 프론트 — index.css 블럭 스타일

**Files:**
- Modify: `web/src/index.css` (파일 끝에 추가)

- [ ] **Step 1: `index.css` 끝(현재 128번째 줄 `pre.viewer` 블록 아래)에 추가**

기존 토큰(`--card`, `--border`, `--muted`, `--accent` 등)을 재사용한다. 기존 `.cards`/`.card`(Overview 카드)와 충돌하지 않도록 `cat-` 접두사를 쓴다.

```css
/* --- Catalog 블럭 (1단계) --- */
.cat-section { margin-bottom: 26px; }
.cat-section h3 { display: flex; align-items: center; gap: 8px; }
.cat-count {
  font-size: 12px; color: var(--muted); background: var(--active-bg);
  border-radius: 10px; padding: 1px 9px; font-weight: 600;
}
.cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.cat-card.expanded { grid-column: 1 / -1; }

.cat-card {
  background: var(--card); border: 1px solid var(--border); border-radius: 9px;
  box-shadow: var(--shadow); overflow: hidden;
}
.cat-card.expanded { border-color: var(--accent); }
.cat-card-head {
  display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 8px;
  width: 100%; text-align: left; background: none; border: none; cursor: pointer;
  color: var(--text); padding: 11px 13px; font: inherit;
}
.cat-name { font-weight: 650; font-size: 13px; }
.cat-chev { color: var(--muted); font-size: 12px; }
.cat-desc {
  grid-column: 1 / -1; color: var(--muted); font-size: 12px; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.cat-meta { grid-column: 1 / -1; color: var(--muted); font-size: 11px; opacity: 0.8; }

.bdg {
  display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.3px;
  padding: 1px 6px; border-radius: 5px; color: #fff;
}
.bdg-skill { background: #3b82f6; }
.bdg-agent { background: #8b5cf6; }
.bdg-command { background: #10b981; }
.bdg-mcp { background: #f59e0b; }
.t-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 5px;
  border: 1px solid var(--border); color: var(--muted);
}

.cat-detail { padding: 0 13px 13px; border-top: 1px solid var(--border); margin-top: 2px; }
.cat-path { color: var(--muted); padding-top: 10px; word-break: break-all; }
.cat-detail-meta { color: var(--muted); font-size: 11px; margin-top: 3px; }
.sec-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
  color: var(--muted); margin: 12px 0 5px;
}
.fm-table { margin-top: 4px; }
.fm-row { display: flex; align-items: baseline; gap: 8px; font-size: 12px; padding: 2px 0; }
.fm-k { width: 120px; flex-shrink: 0; color: var(--muted); font-weight: 600; }
.fm-v { flex: 1; word-break: break-all; }
.eye { background: none; border: none; cursor: pointer; font-size: 12px; padding: 0 4px; }

.md-body { font-size: 13px; line-height: 1.6; }
.md-body h1, .md-body h2, .md-body h3, .md-body h4 { margin: 12px 0 6px; }
.md-body h1 { font-size: 17px; }
.md-body h2 { font-size: 15px; }
.md-body h3 { font-size: 14px; }
.md-body ul, .md-body ol { margin: 6px 0 6px 20px; padding: 0; }
.md-body code {
  background: var(--active-bg); border-radius: 4px; padding: 1px 5px;
  font-family: Consolas, monospace; font-size: 12px;
}
.md-body pre {
  background: var(--editor-bg); border: 1px solid var(--border); border-radius: 6px;
  padding: 12px; overflow: auto;
}
.md-body pre code { background: none; padding: 0; }
.md-body a { color: var(--accent); }
.md-body table { margin: 8px 0; }
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: 통과(CSS는 타입체크 대상 아님 — TS 변화 없으면 그대로 통과 확인용).

---

## Task 6: 통합 검증

- [ ] **Step 1: 전체 타입체크**

Run: `npm run typecheck`
Expected: server + web 모두 에러 0.

- [ ] **Step 2: dev 수동 확인**

Run: `npm run dev` (두 서버 기동) → 브라우저 http://127.0.0.1:5173 → Catalog 탭.
확인 항목:
- Skills/Agents/Commands/MCP Servers/플러그인 5개 섹션이 보인다(각 개수 배지).
- 카탈로그 카드 클릭 → 그 자리에서 펼쳐지고(다른 펼침은 접힘), 경로·메타·Frontmatter 표·**마크다운 렌더 본문**이 보인다.
- 대형 에이전트(19KB+)는 카드에 ⚠ 표시.
- MCP 카드(있으면) 클릭 → 연결 설정 표, env/headers 값은 `••••`로 가려지고 👁 클릭 시 노출.
- 콘솔 에러 없음.

- [ ] **Step 3: e2e 스모크**

Run(두 dev 서버가 떠 있는 상태에서): `python e2e-check.py`
Expected: 탭 순회 중 콘솔 에러 0, Catalog 스크린샷 생성.

---

## Self-Review (작성자 체크 결과)

- **Spec coverage:** 레이아웃(종류별 그룹+카드 Task4/5) · 인라인 확장(Task4) · 마크다운 본문(Task3/4) · 프론트매터 전체(Task1 content API + Task4 표) · MCP 통합(Task2/4) · 시크릿 마스킹+토글(Task4) · MCP read-only(쓰기 라우트 없음) — 모두 task로 커버.
- **Placeholder scan:** TBD/TODO 없음. 모든 코드 스텝에 완전한 코드 포함.
- **Type consistency:** `CatalogContent`(raw/frontmatter/size/mtime/truncated)와 `McpServer`(name/scope/projectPath/transport/command/args/env/url/headers)가 server·web 양쪽에서 동일 필드. 엔드포인트 경로 `/api/catalog/content`, `/api/mcp` 일치.
- **잔여(설계 §미해결):** MCP tools 개수 표시는 1단계 제외. MCP 저장 위치는 Task2가 user/project 양쪽 수용으로 흡수.
```
