import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createJSONEditor, type Content } from "vanilla-jsoneditor";
import "vanilla-jsoneditor/themes/jse-theme-dark.css";
import { api, fmtSize, fmtDate, ApiError } from "../api/client";
import type { NormalizedConfigFile, ProviderFilter } from "@shared/provider-types";
import { providerBadgeClass, providerLabel } from "./workspace-shared";

const LEGACY_CONFIGS = {
  settings: { label: "settings.json" },
  "settings-local": { label: "settings.local.json" },
  "claude-json": { label: ".claude.json (읽기 전용)" },
} as const;

type LegacyConfigName = keyof typeof LEGACY_CONFIGS;

interface Props {
  providerFilter: ProviderFilter;
}

interface ConfigData {
  content: string;
  sha256: string;
  mtime: number;
  writable: boolean;
  path: string;
}

interface BackupInfo {
  name: string;
  size: number;
  mtime: number;
}

type EditorInstance = ReturnType<typeof createJSONEditor>;

function contentToText(c: Content): string {
  if ("text" in c && typeof c.text === "string") return c.text;
  if ("json" in c) return JSON.stringify((c as { json: unknown }).json, null, 2);
  return "";
}

function JsonTreeEditor({
  initialText,
  readOnly,
  isDark,
  onChangeText,
  apiRef,
}: {
  initialText: string;
  readOnly: boolean;
  isDark: boolean;
  onChangeText: (t: string) => void;
  apiRef: React.MutableRefObject<EditorInstance | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChangeText);
  onChangeRef.current = onChangeText;
  const initialRef = useRef(initialText);

  useEffect(() => {
    const editor = createJSONEditor({
      target: container.current!,
      props: {
        content: { text: initialRef.current },
        readOnly,
        mainMenuBar: true,
        onChange: (updated: Content) => {
          onChangeRef.current(contentToText(updated));
        },
      },
    });
    apiRef.current = editor;
    return () => {
      editor.destroy();
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => {
    apiRef.current?.updateProps({ readOnly });
  }, [readOnly, apiRef]);

  return <div ref={container} className={`jse-wrap${isDark ? " jse-theme-dark" : ""}`} />;
}

function hookEntry(shell: "powershell" | "bash") {
  return {
    matcher: "Write|Edit|MultiEdit",
    hooks: [
      {
        type: "command",
        command: 'node "$HOME/.claude/hooks/stamp-plan-session.mjs"',
        shell,
      },
    ],
  };
}

function HookInstallPanel() {
  const [content, setContent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [os, setOs] = useState<"windows" | "unix">("windows");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get<{ content: string }>("/api/hooks/stamp-plan-session")
      .then((d) => setContent(d.content))
      .catch(() => setFailed(true));
  }, []);

  if (failed || content === null) return null;

  const prompt = [
    "Claude Code 글로벌 환경에 '계획 파일에 작성 세션ID를 자동으로 새겨넣는' hook을 설치해줘.",
    "",
    "1. 아래 내용 그대로 `~/.claude/hooks/stamp-plan-session.mjs` 파일을 만들어줘(디렉토리가 없으면 만들어서):",
    "",
    "```javascript",
    content,
    "```",
    "",
    "2. `~/.claude/settings.json`을 읽어서 `hooks.PostToolUse` 배열(없으면 새로 만들어)에 아래 항목을 추가해줘",
    "(이미 같은 command를 가진 항목이 있으면 건드리지 마):",
    "",
    "```json",
    JSON.stringify(hookEntry(os === "windows" ? "powershell" : "bash"), null, 2),
    "```",
    "",
    "3. 끝나면 아무 계획 파일이나 하나 저장(Write/Edit)해서 파일 맨 앞에",
    "`<!-- claude-session: ... -->` 마커가 자동으로 붙는지 확인해줘.",
  ].join("\n");

  const copyPrompt = () => {
    navigator.clipboard.writeText(prompt).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <div>
      <h3>다른 PC에 세션-계획 연결 Hook 설치</h3>
      <p className="muted">
        이 PC에는 계획 파일에 작성 세션ID를 자동으로 새겨넣는 hook이 설치돼 있습니다. 다른 PC의
        Claude Code에 붙여넣을 설치 프롬프트를 복사하세요.
      </p>
      <p>
        <button
          className={`btn ghost${os === "windows" ? " active" : ""}`}
          style={os === "windows" ? { borderColor: "var(--accent)" } : undefined}
          onClick={() => setOs("windows")}
        >
          Windows
        </button>
        <button
          className={`btn ghost${os === "unix" ? " active" : ""}`}
          style={os === "unix" ? { borderColor: "var(--accent)" } : undefined}
          onClick={() => setOs("unix")}
        >
          macOS / Linux
        </button>
      </p>
      <p>
        <button className="btn" onClick={copyPrompt}>
          {copied ? "복사됨" : "설치 프롬프트 복사"}
        </button>
      </p>
    </div>
  );
}

function toLegacyConfigName(id: string): LegacyConfigName | null {
  return id in LEGACY_CONFIGS ? (id as LegacyConfigName) : null;
}

export default function ConfigEditor({ providerFilter }: Props) {
  const [files, setFiles] = useState<NormalizedConfigFile[]>([]);
  const [selectedId, setSelectedId] = useState<string>("settings");
  const [data, setData] = useState<ConfigData | null>(null);
  const [text, setText] = useState("");
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute("data-theme") !== "light",
  );
  const editorRef = useRef<EditorInstance | null>(null);
  const providerQuery = `provider=${encodeURIComponent(providerFilter)}`;

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedId) ?? null,
    [files, selectedId],
  );
  const legacyName = selectedFile ? toLegacyConfigName(selectedFile.id) : null;

  const loadLegacy = useCallback((name: LegacyConfigName) => {
    setMessage(null);
    setExternalChange(false);
    api
      .get<ConfigData>(`/api/configs/${name}`)
      .then((d) => {
        setData(d);
        setText(d.content);
        editorRef.current?.update({ text: d.content });
      })
      .catch((e) => setMessage({ kind: "err", text: e.message }));
    api
      .get<BackupInfo[]>(`/api/configs/${name}/backups`)
      .then(setBackups)
      .catch(() => setBackups([]));
  }, []);

  useEffect(() => {
    setMessage(null);
    api
      .get<NormalizedConfigFile[]>(`/api/config/files?${providerQuery}`)
      .then((nextFiles) => {
        setFiles(nextFiles);
        setSelectedId((prev) => {
          if (nextFiles.some((file) => file.id === prev)) return prev;
          const preferred = nextFiles.find((file) => toLegacyConfigName(file.id));
          return preferred?.id ?? nextFiles[0]?.id ?? "";
        });
      })
      .catch((e) => setMessage({ kind: "err", text: e.message }));
  }, [providerQuery]);

  useEffect(() => {
    if (!legacyName) {
      setData(null);
      setText("");
      setBackups([]);
      setExternalChange(false);
      return;
    }
    loadLegacy(legacyName);
  }, [legacyName, loadLegacy]);

  useEffect(() => {
    if (!data || !legacyName) return;
    const t = setInterval(() => {
      api
        .get<ConfigData>(`/api/configs/${legacyName}`)
        .then((d) => {
          if (d.sha256 !== data.sha256) setExternalChange(true);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [legacyName, data]);

  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(el.getAttribute("data-theme") !== "light"));
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const jsonValid = (() => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  })();

  const save = async () => {
    if (!data || !legacyName) return;
    try {
      const res = await api.put<{ sha256: string; backup: string }>(`/api/configs/${legacyName}`, {
        content: text,
        baseHash: data.sha256,
      });
      setMessage({ kind: "ok", text: `저장 완료 (백업: ${res.backup})` });
      loadLegacy(legacyName);
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
    if (!legacyName || !confirm(`${backup} 으로 복원할까요? (현재본도 백업됩니다)`)) return;
    try {
      await api.post(`/api/configs/${legacyName}/restore`, { backup });
      setMessage({ kind: "ok", text: "복원 완료" });
      loadLegacy(legacyName);
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    }
  };

  const prettify = () => {
    try {
      const p = JSON.stringify(JSON.parse(text), null, 2);
      setText(p);
      editorRef.current?.update({ text: p });
    } catch {
      setMessage({ kind: "err", text: "JSON 파싱 오류 — 정렬할 수 없습니다" });
    }
  };

  const dirty = data !== null && text !== data.content;

  return (
    <div>
      <h2>
        Config Editor{" "}
        <span className={`provider-badge ${providerFilter !== "all" ? providerBadgeClass(providerFilter) : ""}`}>
          {providerFilter === "all" ? "All Providers" : providerLabel(providerFilter)}
        </span>
      </h2>
      <p>
        {files.map((file) => (
          <button
            key={file.id}
            className={`btn ghost${selectedId === file.id ? " active" : ""}`}
            style={selectedId === file.id ? { borderColor: "var(--accent)" } : undefined}
            onClick={() => setSelectedId(file.id)}
            title={file.path}
          >
            {file.label}
          </button>
        ))}
      </p>

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}
      {externalChange && legacyName && (
        <div className="banner warn">
          파일이 외부에서 변경되었습니다. <button className="btn ghost" onClick={() => loadLegacy(legacyName)}>다시 불러오기</button>
        </div>
      )}

      {!selectedFile && <div className="muted">표시할 설정 파일이 없습니다.</div>}

      {selectedFile && !legacyName && (
        <div className="ws-detail-inner cfg-placeholder">
          <div className="cat-detail-title">
            <span className={`provider-badge ${providerBadgeClass(selectedFile.provider)}`}>{providerLabel(selectedFile.provider)}</span>
            <span className="cat-detail-name">{selectedFile.label}</span>
          </div>
          <p className="muted mono">{selectedFile.path}</p>
          <div className="banner warn">
            이 provider 설정 편집 UI는 Task 11 범위입니다. 현재는 파일 목록만 노출하며, Claude 기존 설정 편집기 동작은 그대로 유지합니다.
          </div>
        </div>
      )}

      {data && selectedFile && legacyName && (
        <div>
          {!data.writable && (
            <div className="banner warn">
              이 파일은 읽기 전용입니다. CC가 상시 재작성하므로 수정은 전 세션 종료 후
              archive\2026-06-11\cleanup-claude-json.ps1 같은 수동 절차를 사용하세요.
            </div>
          )}
          <p className="muted mono">
            {data.path} — {fmtDate(data.mtime)}
          </p>
          <JsonTreeEditor
            initialText={text}
            readOnly={!data.writable}
            isDark={isDark}
            onChangeText={setText}
            apiRef={editorRef}
          />
          <p>
            <button className="btn" onClick={save} disabled={!data.writable || !dirty || !jsonValid}>
              저장
            </button>
            <button className="btn ghost" onClick={prettify} disabled={!data.writable || !jsonValid}>
              정렬
            </button>
            {!jsonValid && <span className="tag warn">JSON 파싱 오류 — 저장 불가</span>}
            {dirty && jsonValid && <span className="tag muted">수정됨</span>}
          </p>

          <h3>백업 ({backups.length})</h3>
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th className="num">크기</th>
                <th>시각</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name}>
                  <td className="mono">{b.name}</td>
                  <td className="num">{fmtSize(b.size)}</td>
                  <td>{fmtDate(b.mtime)}</td>
                  <td>
                    {data.writable && (
                      <button className="btn ghost" onClick={() => restore(b.name)}>
                        복원
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    백업 없음
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {providerFilter !== "codex" && <HookInstallPanel />}
    </div>
  );
}
