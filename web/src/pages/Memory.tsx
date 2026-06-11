import { useEffect, useState } from "react";
import { api, fmtSize, fmtDate } from "../api/client";

interface ProjectInfo {
  id: string;
  size: number;
  transcriptCount: number;
  memoryFileCount: number;
  lastActivity: number;
  staleDays: number;
  originalPathExists: boolean | null;
}

interface FileInfo { path: string; size: number; mtime: number }

export default function Memory() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [content, setContent] = useState<{ path: string; text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    api.get<ProjectInfo[]>("/api/projects").then(setProjects).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const open = (id: string) => {
    setSelected(id);
    setContent(null);
    api.get<FileInfo[]>(`/api/projects/${encodeURIComponent(id)}/files`).then(setFiles).catch((e) => setError(e.message));
  };

  const openFile = (rel: string) => {
    api
      .get<{ content: string; truncated: boolean }>(
        `/api/projects/${encodeURIComponent(selected!)}/file?path=${encodeURIComponent(rel)}`,
      )
      .then((d) => setContent({ path: rel, text: d.content, truncated: d.truncated }))
      .catch((e) => setError(e.message));
  };

  return (
    <div>
      <h2>Memory / Projects</h2>
      {error && <div className="banner err">{error}</div>}
      <table>
        <thead>
          <tr><th>프로젝트</th><th className="num">크기</th><th className="num">트랜스크립트</th><th className="num">메모리</th><th>마지막 활동</th><th>경과</th><th>원본 경로</th></tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} onClick={() => open(p.id)} style={{ cursor: "pointer", background: selected === p.id ? "#262a31" : undefined }}>
              <td className="mono">{p.id}</td>
              <td className="num">{fmtSize(p.size)}</td>
              <td className="num">{p.transcriptCount}</td>
              <td className="num">{p.memoryFileCount}</td>
              <td>{p.lastActivity ? fmtDate(p.lastActivity) : "-"}</td>
              <td>{p.staleDays >= 30 ? <span className="tag warn">{p.staleDays}일</span> : <span className="tag ok">{p.staleDays}일</span>}</td>
              <td>{p.originalPathExists === null ? <span className="tag muted">불명</span> : p.originalPathExists ? <span className="tag ok">존재</span> : <span className="tag warn">없음</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <div>
          <h3>{selected} 파일</h3>
          <p className="muted">아카이브는 Cleanup 페이지에서 해당 프로젝트를 선택해 실행하세요.</p>
          <table>
            <thead><tr><th>경로</th><th className="num">크기</th><th>수정일</th></tr></thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.path} onClick={() => openFile(f.path)} style={{ cursor: "pointer" }}>
                  <td className="mono">{f.path}</td>
                  <td className="num">{fmtSize(f.size)}</td>
                  <td>{fmtDate(f.mtime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {content && (
            <div>
              <h3 className="mono">{content.path} {content.truncated && <span className="tag warn">앞부분만 표시</span>}</h3>
              <pre className="viewer">{content.text}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
