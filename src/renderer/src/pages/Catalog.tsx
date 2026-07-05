import { useEffect, useState, type ReactNode } from "react";
import { marked } from "marked";
import { api, fmtSize, fmtDate } from "../api/client";
import type { ProviderFilter, ProviderId } from "@shared/provider-types";
import { providerLabel } from "./workspace-shared";
import { groupRowsByProvider, providerGroupLabel, providerToneClass } from "../provider-ui";

interface CatalogItem {
  name: string;
  kind: "skill" | "agent" | "command";
  provider?: ProviderId;
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
  provider?: ProviderId;
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

// 좌측 종류 필터(세그먼트). skill/agent/command는 CatalogItem.kind, mcp/plugin은 별도 소스.
type KindFilter = "all" | "skill" | "agent" | "command" | "mcp" | "plugin";
const SEGMENTS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "skill", label: "Skill" },
  { key: "agent", label: "Agent" },
  { key: "command", label: "Command" },
  { key: "mcp", label: "MCP" },
  { key: "plugin", label: "Plugin" },
];
const ITEM_BADGE: Record<CatalogItem["kind"], string> = {
  skill: "SKILL",
  agent: "AGENT",
  command: "CMD",
};
const GROUP_LABEL: Record<Exclude<KindFilter, "all">, string> = {
  skill: "Skills",
  agent: "Agents",
  command: "Commands",
  mcp: "MCP Servers",
  plugin: "Plugins",
};

const mcpKey = (m: McpServer) => `mcp:${m.provider ?? "unknown"}:${m.scope}:${m.projectPath ?? ""}:${m.name}`;

export const CATALOG_PROVIDER_TABS: { key: ProviderFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "claude", label: "Claude" },
  { key: "codex", label: "Codex" },
];

export function filterCatalogItemsByProvider<T extends { provider?: ProviderId }>(
  rows: T[],
  provider: ProviderFilter,
): T[] {
  return provider === "all" ? rows : rows.filter((row) => row.provider === provider);
}

// 현재 plugin catalog는 Claude Code의 ~/.claude/plugins만 읽는다. Codex 탭에서는 숨겨 오염을 막는다.
export function filterCatalogPluginsByProvider<T>(rows: T[], provider: ProviderFilter): T[] {
  return provider === "codex" ? [] : rows;
}

interface Props {
  providerFilter: ProviderFilter;
}

export default function Catalog({ providerFilter }: Props) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [mcps, setMcps] = useState<McpServer[]>([]);
  const [error, setError] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [content, setContent] = useState<Record<string, CatalogContent>>({});
  const [query, setQuery] = useState(() => localStorage.getItem("hm-cat-q") ?? "");
  const [kind, setKind] = useState<KindFilter>(
    () => (localStorage.getItem("hm-cat-kind") as KindFilter | null) ?? "all",
  );
  const [catalogProviderFilter, setCatalogProviderFilter] = useState<ProviderFilter>(
    () => (localStorage.getItem("hm-cat-provider") as ProviderFilter | null) ?? providerFilter ?? "all",
  );
  const providerQuery = "provider=all";

  useEffect(() => {
    setSelectedKey(null);
    setContent({});
    setError("");
    api.get<CatalogItem[]>(`/api/catalog?${providerQuery}`).then(setItems).catch((e) => setError(e.message));
    api
      .get<{ plugins: PluginInfo[] }>("/api/plugins")
      .then((d) => setPlugins(d.plugins))
      .catch((e) => setError(e.message));
    api.get<McpServer[]>(`/api/mcp?${providerQuery}`).then(setMcps).catch((e) => setError(e.message));
  }, [providerQuery]);

  const changeQuery = (v: string) => {
    setQuery(v);
    localStorage.setItem("hm-cat-q", v);
  };
  const changeKind = (k: KindFilter) => {
    setKind(k);
    localStorage.setItem("hm-cat-kind", k);
  };
  const changeCatalogProvider = (p: ProviderFilter) => {
    setCatalogProviderFilter(p);
    localStorage.setItem("hm-cat-provider", p);
    setSelectedKey(null);
  };

  // 항목 선택(펼침 대체). skill/agent/command는 본문을 lazy-fetch.
  async function selectItem(key: string, path?: string) {
    setSelectedKey(key);
    if (path && !content[path]) {
      try {
        const c = await api.get<CatalogContent>(
          `/api/catalog/content?path=${encodeURIComponent(path)}`,
        );
        setContent((prev) => ({ ...prev, [path]: c }));
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  const q = query.trim().toLowerCase();
  const hit = (...parts: (string | undefined)[]) =>
    q === "" || parts.some((p) => p && p.toLowerCase().includes(q));

  const scopedItems = filterCatalogItemsByProvider(items, catalogProviderFilter);
  const scopedMcps = filterCatalogItemsByProvider(mcps, catalogProviderFilter);
  const scopedPlugins = filterCatalogPluginsByProvider(plugins, catalogProviderFilter);

  const itemRows = (k: CatalogItem["kind"]) =>
    scopedItems.filter((i) => i.kind === k && hit(i.name, i.description));
  const mcpRows = scopedMcps.filter((m) => hit(m.name, m.projectPath));
  const pluginRows = scopedPlugins.filter((p) => hit(p.id));

  const providerCounts: Record<ProviderFilter, number> = {
    all: items.length + mcps.length + plugins.length,
    claude:
      filterCatalogItemsByProvider(items, "claude").length +
      filterCatalogItemsByProvider(mcps, "claude").length +
      filterCatalogPluginsByProvider(plugins, "claude").length,
    codex:
      filterCatalogItemsByProvider(items, "codex").length +
      filterCatalogItemsByProvider(mcps, "codex").length +
      filterCatalogPluginsByProvider(plugins, "codex").length,
  };

  const counts: Record<KindFilter, number> = {
    skill: itemRows("skill").length,
    agent: itemRows("agent").length,
    command: itemRows("command").length,
    mcp: mcpRows.length,
    plugin: pluginRows.length,
    all: 0,
  };
  counts.all = counts.skill + counts.agent + counts.command + counts.mcp + counts.plugin;

  const showGroup = (g: Exclude<KindFilter, "all">) => kind === "all" || kind === g;

  function itemGroup(k: CatalogItem["kind"]): ReactNode {
    const rows = itemRows(k);
    if (!showGroup(k) || rows.length === 0) return null;
    const groups =
      catalogProviderFilter === "all" ? groupRowsByProvider(rows) : [{ provider: catalogProviderFilter as ProviderId, rows }];
    return (
      <div key={k}>
        {groups.map((group) => (
          <div key={`${k}:${group.provider}`}>
            <div className="cat-group-head">
              {GROUP_LABEL[k]}{catalogProviderFilter === "all" ? ` · ${providerGroupLabel(group.provider)}` : ""}{" "}
              <span className="cat-count">{group.rows.length}</span>
            </div>
            {group.rows.map((it) => {
              const key = `item:${it.path}`;
              return (
                <button
                  key={it.path}
                  className={`cat-master-item${selectedKey === key ? " active" : ""}`}
                  onClick={() => selectItem(key, it.path)}
                >
                  <div className="cat-mi-head">
                    {it.provider && catalogProviderFilter === "all" && (
                      <span className={`provider-badge ${providerToneClass(it.provider)}`}>{providerLabel(it.provider)}</span>
                    )}
                    <span className={`bdg bdg-${k}`}>{ITEM_BADGE[k]}</span>
                    <span className="cat-mi-name">{it.name}</span>
                    {it.warn && <span className="tag warn">⚠</span>}
                  </div>
                  <div className="cat-mi-meta">
                    <span>{fmtSize(it.size)}</span>
                    <span>{fmtDate(it.mtime)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  const detail = renderDetail(selectedKey, items, mcps, plugins, content);

  return (
    <div className="cat-page">
      <h2>
        Catalog{" "}
        <span className={`provider-badge ${providerToneClass(catalogProviderFilter)}`}>
          {catalogProviderFilter === "all" ? "All Providers" : providerGroupLabel(catalogProviderFilter)}
        </span>
      </h2>
      {error && <div className="banner err">{error}</div>}

      <div className="cat-provider-tabs" role="tablist" aria-label="Catalog provider">
        {CATALOG_PROVIDER_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={catalogProviderFilter === tab.key}
            className={`cat-provider-tab ${providerToneClass(tab.key)}${catalogProviderFilter === tab.key ? " active" : ""}`}
            onClick={() => changeCatalogProvider(tab.key)}
          >
            {tab.label} <span className="cat-seg-n">{providerCounts[tab.key]}</span>
          </button>
        ))}
      </div>

      <div className="cat-split">
        <div className="cat-master-col">
          <div className="cat-toolbar">
            <input
              className="cat-search"
              type="text"
              placeholder="이름·설명 검색…"
              value={query}
              onChange={(e) => changeQuery(e.target.value)}
            />
            <div className="cat-seg">
              {SEGMENTS.map((s) => (
                <button
                  key={s.key}
                  className={`cat-seg-btn${kind === s.key ? " active" : ""}`}
                  onClick={() => changeKind(s.key)}
                >
                  {s.label} <span className="cat-seg-n">{counts[s.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ws-master cat-master">
            {itemGroup("skill")}
            {itemGroup("agent")}
            {itemGroup("command")}
            {showGroup("mcp") && mcpRows.length > 0 && (
              <div>
                {(catalogProviderFilter === "all"
                  ? groupRowsByProvider(mcpRows)
                  : [{ provider: catalogProviderFilter as ProviderId, rows: mcpRows }]
                ).map((group) => (
                  <div key={`mcp:${group.provider}`}>
                    <div className="cat-group-head">
                      {GROUP_LABEL.mcp}{catalogProviderFilter === "all" ? ` · ${providerGroupLabel(group.provider)}` : ""}{" "}
                      <span className="cat-count">{group.rows.length}</span>
                    </div>
                    {group.rows.map((m) => {
                      const key = mcpKey(m);
                      return (
                        <button
                          key={key}
                          className={`cat-master-item${selectedKey === key ? " active" : ""}`}
                          onClick={() => selectItem(key)}
                        >
                          <div className="cat-mi-head">
                            {m.provider && catalogProviderFilter === "all" && (
                              <span className={`provider-badge ${providerToneClass(m.provider)}`}>{providerLabel(m.provider)}</span>
                            )}
                            <span className="bdg bdg-mcp">MCP</span>
                            <span className="cat-mi-name">{m.name}</span>
                            <span className="t-tag">{m.transport}</span>
                          </div>
                          <div className="cat-mi-meta">
                            <span>{m.scope === "project" ? `project: ${m.projectPath}` : "user scope"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            {showGroup("plugin") && pluginRows.length > 0 && (
              <div>
                <div className="cat-group-head">
                  {GROUP_LABEL.plugin}{catalogProviderFilter === "all" ? " · Claude Code" : ""}{" "}
                  <span className="cat-count">{pluginRows.length}</span>
                </div>
                {pluginRows.map((p) => {
                  const key = `plugin:${p.id}`;
                  return (
                    <button
                      key={p.id}
                      className={`cat-master-item${selectedKey === key ? " active" : ""}`}
                      onClick={() => selectItem(key)}
                    >
                      <div className="cat-mi-head">
                        <span className="bdg bdg-plugin">PLUGIN</span>
                        <span className="cat-mi-name">{p.id}</span>
                        {p.enabledInSettings === true && <span className="tag ok">on</span>}
                        {p.enabledInSettings === false && <span className="tag warn">off</span>}
                        {p.blocked && <span className="tag warn">blocked</span>}
                      </div>
                      <div className="cat-mi-meta">
                        <span>
                          {p.installs.map((i) => `${i.scope} v${i.version}`).join(", ") || "설치 정보 없음"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {counts.all === 0 && (
              <div className="muted cat-master-empty">
                {items.length + mcps.length + plugins.length === 0
                  ? "불러오는 중…"
                  : "일치하는 항목이 없습니다."}
              </div>
            )}
          </div>
        </div>

        <div className="ws-detail">
          <div className="ws-detail-inner">{detail}</div>
        </div>
      </div>
    </div>
  );
}

function renderDetail(
  selectedKey: string | null,
  items: CatalogItem[],
  mcps: McpServer[],
  plugins: PluginInfo[],
  content: Record<string, CatalogContent>,
): ReactNode {
  if (!selectedKey) return <div className="cat-detail-empty">왼쪽에서 항목을 선택하세요.</div>;
  if (selectedKey.startsWith("item:")) {
    const it = items.find((i) => `item:${i.path}` === selectedKey);
    if (it) return <ItemDetail it={it} data={content[it.path]} />;
  } else if (selectedKey.startsWith("mcp:")) {
    const m = mcps.find((x) => mcpKey(x) === selectedKey);
    if (m) return <McpDetail m={m} />;
  } else if (selectedKey.startsWith("plugin:")) {
    const p = plugins.find((x) => `plugin:${x.id}` === selectedKey);
    if (p) return <PluginDetail p={p} />;
  }
  return <div className="cat-detail-empty">항목을 찾을 수 없습니다.</div>;
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="cat-copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => {},
        );
      }}
    >
      {done ? "복사됨 ✓" : "복사"}
    </button>
  );
}

function ItemDetail({ it, data }: { it: CatalogItem; data?: CatalogContent }) {
  return (
    <div className="cat-detail">
      <div className="cat-detail-title">
        {it.provider && <span className={`provider-badge ${providerToneClass(it.provider)}`}>{providerGroupLabel(it.provider)}</span>}
        <span className={`bdg bdg-${it.kind}`}>{ITEM_BADGE[it.kind]}</span>
        <span className="cat-detail-name">{it.name}</span>
      </div>
      <div className="cat-path mono">
        {it.path}
        <CopyBtn text={it.path} />
      </div>
      {!data ? (
        <div className="muted cat-detail-loading">불러오는 중…</div>
      ) : (
        <>
          <div className="cat-detail-meta">
            {fmtSize(data.size)} · 수정 {fmtDate(data.mtime)}
            {data.truncated && " · (대형 파일 일부만 표시)"}
          </div>
          {Object.keys(data.frontmatter ?? {}).length > 0 && (
            <div className="fm-table">
              <div className="sec-label">Frontmatter</div>
              {Object.keys(data.frontmatter).map((k) => {
                const v = data.frontmatter[k];
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
        </>
      )}
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
      <div className="cat-detail-title">
        {m.provider && <span className={`provider-badge ${providerToneClass(m.provider)}`}>{providerGroupLabel(m.provider)}</span>}
        <span className="bdg bdg-mcp">MCP</span>
        <span className="cat-detail-name">{m.name}</span>
        <span className="t-tag">{m.transport}</span>
      </div>
      <div className="cat-path mono">
        {m.provider === "codex" ? "~/.codex/config.toml" : "~/.claude.json"} · {m.scope === "project" ? m.projectPath : "user scope"}
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
      <div className="cat-detail-title">
        <span className="bdg bdg-plugin">PLUGIN</span>
        <span className="cat-detail-name">{p.id}</span>
      </div>
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
