import { useEffect, useState } from "react";
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

export default function Catalog() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<CatalogItem[]>("/api/catalog").then(setItems).catch((e) => setError(e.message));
    api
      .get<{ plugins: PluginInfo[] }>("/api/plugins")
      .then((d) => setPlugins(d.plugins))
      .catch((e) => setError(e.message));
  }, []);

  const byKind = (kind: CatalogItem["kind"]) => items.filter((i) => i.kind === kind);

  return (
    <div>
      <h2>Catalog</h2>
      {error && <div className="banner err">{error}</div>}

      <h3>플러그인</h3>
      <table>
        <thead><tr><th>ID</th><th>활성</th><th>설치</th></tr></thead>
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
                {p.installs.map((i) => `${i.scope}${i.projectPath ? ` (${i.projectPath})` : ""} v${i.version}`).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {(["skill", "agent", "command"] as const).map((kind) => (
        <div key={kind}>
          <h3>{kind === "skill" ? "개인 스킬" : kind === "agent" ? "커스텀 에이전트" : "Slash 커맨드"} ({byKind(kind).length})</h3>
          <table>
            <thead><tr><th>이름</th><th>설명</th><th className="num">크기</th><th>수정일</th><th></th></tr></thead>
            <tbody>
              {byKind(kind).map((i) => (
                <tr key={i.path}>
                  <td className="mono">{i.name}</td>
                  <td className="muted">{i.description.slice(0, 90)}</td>
                  <td className="num">{fmtSize(i.size)}</td>
                  <td>{fmtDate(i.mtime)}</td>
                  <td>{i.warn && <span className="tag warn">{i.warn}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
