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
          Plugins <span className="cat-count">{plugins.length}</span>
        </h3>
        <div className="cat-grid">
          {plugins.map((p) => {
            const key = `plugin:${p.id}`;
            const open = openKey === key;
            return (
              <div className={`cat-card${open ? " expanded" : ""}`} key={p.id}>
                <button className="cat-card-head" onClick={() => setOpenKey(open ? null : key)}>
                  <span className="bdg bdg-plugin">PLUGIN</span>
                  <span className="cat-name">{p.id}</span>
                  <span className="cat-tags">
                    {p.enabledInSettings === true && <span className="tag ok">enabled</span>}
                    {p.enabledInSettings === false && <span className="tag warn">disabled</span>}
                    {p.enabledInSettings === null && <span className="tag muted">project</span>}
                    {p.blocked && <span className="tag warn">blocked</span>}
                  </span>
                  <span className="cat-chev">{open ? "▴" : "▾"}</span>
                  <div className="cat-desc">
                    {p.installs.map((i) => `${i.scope} v${i.version}`).join(", ") || "설치 정보 없음"}
                  </div>
                </button>
                {open && <PluginDetail p={p} />}
              </div>
            );
          })}
          {plugins.length === 0 && <div className="muted">플러그인이 없습니다.</div>}
        </div>
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

function PluginDetail({ p }: { p: PluginInfo }) {
  return (
    <div className="cat-detail">
      <div className="sec-label">상태</div>
      <div className="fm-row">
        <span className="fm-k">설정 활성</span>
        <span className="fm-v mono">
          {p.enabledInSettings === null ? "프로젝트 레벨" : p.enabledInSettings ? "enabled" : "disabled"}
        </span>
      </div>
      <div className="fm-row">
        <span className="fm-k">차단</span>
        <span className="fm-v mono">{p.blocked ? "blocked" : "no"}</span>
      </div>
      <div className="sec-label">설치 ({p.installs.length})</div>
      {p.installs.map((i, idx) => (
        <div className="fm-row" key={idx}>
          <span className="fm-k">{i.scope}</span>
          <span className="fm-v mono">
            {i.projectPath ? `${i.projectPath} · ` : ""}v{i.version}
          </span>
        </div>
      ))}
      {p.installs.length === 0 && <div className="muted">설치 기록 없음</div>}
    </div>
  );
}
