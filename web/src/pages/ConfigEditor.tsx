import { useCallback, useEffect, useState } from "react";
import { api, fmtSize, fmtDate, ApiError } from "../api/client";

const CONFIGS = [
  { name: "settings", label: "settings.json" },
  { name: "settings-local", label: "settings.local.json" },
  { name: "claude-json", label: ".claude.json (읽기 전용)" },
] as const;

interface ConfigData {
  content: string;
  sha256: string;
  mtime: number;
  writable: boolean;
  path: string;
}

interface BackupInfo { name: string; size: number; mtime: number }

export default function ConfigEditor() {
  const [name, setName] = useState<string>("settings");
  const [data, setData] = useState<ConfigData | null>(null);
  const [text, setText] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [externalChange, setExternalChange] = useState(false);

  const load = useCallback((n: string) => {
    setMessage(null);
    setExternalChange(false);
    api.get<ConfigData>(`/api/configs/${n}`).then((d) => {
      setData(d);
      setText(d.content);
    }).catch((e) => setMessage({ kind: "err", text: e.message }));
    api.get<BackupInfo[]>(`/api/configs/${n}/backups`).then(setBackups).catch(() => setBackups([]));
  }, []);

  useEffect(() => { load(name); }, [name, load]);

  // 외부 변경 감지: 5초마다 서버의 sha256과 비교
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => {
      api.get<ConfigData>(`/api/configs/${name}`).then((d) => {
        if (d.sha256 !== data.sha256) setExternalChange(true);
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [name, data]);

  const jsonValid = (() => {
    try { JSON.parse(text); return true; } catch { return false; }
  })();

  const save = async () => {
    if (!data) return;
    try {
      const res = await api.put<{ sha256: string; backup: string }>(`/api/configs/${name}`, {
        content: text,
        baseHash: data.sha256,
      });
      setMessage({ kind: "ok", text: `저장 완료 (백업: ${res.backup})` });
      load(name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setMessage({ kind: "err", text: "충돌(409): 파일이 외부에서 변경되었습니다. 다시 불러오세요." });
        setExternalChange(true);
      } else {
        setMessage({ kind: "err", text: (e as Error).message });
      }
    }
  };

  const restore = async (backup: string) => {
    if (!confirm(`${backup} 으로 복원할까요? (현재본도 백업됩니다)`)) return;
    try {
      await api.post(`/api/configs/${name}/restore`, { backup });
      setMessage({ kind: "ok", text: "복원 완료" });
      load(name);
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    }
  };

  const dirty = data !== null && text !== data.content;

  return (
    <div>
      <h2>Config Editor</h2>
      <p>
        {CONFIGS.map((c) => (
          <button
            key={c.name}
            className={`btn ghost${name === c.name ? " active" : ""}`}
            style={name === c.name ? { borderColor: "var(--accent)" } : undefined}
            onClick={() => setName(c.name)}
          >
            {c.label}
          </button>
        ))}
      </p>

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}
      {externalChange && (
        <div className="banner warn">
          파일이 외부에서 변경되었습니다. <button className="btn ghost" onClick={() => load(name)}>다시 불러오기</button>
        </div>
      )}
      {data && !data.writable && (
        <div className="banner warn">
          이 파일은 읽기 전용입니다. CC가 상시 재작성하므로 수정은 전 세션 종료 후
          archive\2026-06-11\cleanup-claude-json.ps1 같은 수동 절차를 사용하세요.
        </div>
      )}

      {data && (
        <div>
          <p className="muted mono">{data.path} — {fmtDate(data.mtime)}</p>
          <textarea
            className="editor"
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={!data.writable}
            spellCheck={false}
          />
          <p>
            <button className="btn" onClick={save} disabled={!data.writable || !dirty || !jsonValid}>
              저장
            </button>
            {!jsonValid && <span className="tag warn">JSON 파싱 오류 — 저장 불가</span>}
            {dirty && jsonValid && <span className="tag muted">수정됨</span>}
          </p>

          <h3>백업 ({backups.length})</h3>
          <table>
            <thead><tr><th>이름</th><th className="num">크기</th><th>시각</th><th></th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name}>
                  <td className="mono">{b.name}</td>
                  <td className="num">{fmtSize(b.size)}</td>
                  <td>{fmtDate(b.mtime)}</td>
                  <td>
                    {data.writable && (
                      <button className="btn ghost" onClick={() => restore(b.name)}>복원</button>
                    )}
                  </td>
                </tr>
              ))}
              {backups.length === 0 && <tr><td colSpan={4} className="muted">백업 없음</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
