import { useEffect, useState } from "react";
import { api, fmtSize } from "../api/client";

interface Candidate {
  path: string;
  category: string;
  reason: string;
  size: number;
  ageDays: number;
}

interface ManifestEntry { original: string; archived: string; reason: string; movedAt: string }

export default function Cleanup() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manifests, setManifests] = useState<{ date: string; entries: ManifestEntry[] }[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const scan = () => {
    setBusy(true);
    api
      .post<Candidate[]>("/api/cleanup/scan")
      .then((c) => { setCandidates(c); setChecked(new Set()); })
      .catch((e) => setMessage({ kind: "err", text: e.message }))
      .finally(() => setBusy(false));
  };

  const loadManifest = () =>
    api.get<{ date: string; entries: ManifestEntry[] }[]>("/api/cleanup/manifest").then(setManifests).catch(() => {});

  useEffect(() => { scan(); loadManifest(); }, []);

  const movable = candidates.filter((c) => c.category !== "warn-only");
  const selectedItems = movable.filter((c) => checked.has(c.path));

  const toggle = (path: string) => {
    const next = new Set(checked);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setChecked(next);
  };

  const run = async (dryRun: boolean) => {
    if (selectedItems.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<{ dryRun: boolean; wouldMove?: unknown[]; moved?: unknown[] }>(
        "/api/cleanup/execute",
        { dryRun, items: selectedItems },
      );
      if (dryRun) {
        setMessage({ kind: "warn", text: `dry-run: ${res.wouldMove!.length}개 항목이 이동 대상입니다. 실행하려면 "실행"을 누르세요.` });
      } else {
        setMessage({ kind: "ok", text: `${res.moved!.length}개 항목을 아카이브로 이동했습니다.` });
        scan();
        loadManifest();
      }
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (archivedPath: string) => {
    if (!confirm("이 항목을 원위치로 복구할까요?")) return;
    try {
      await api.post("/api/cleanup/restore", { archivedPath });
      setMessage({ kind: "ok", text: "복구 완료" });
      scan();
      loadManifest();
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    }
  };

  return (
    <div>
      <h2>Cleanup</h2>
      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <p>
        <button className="btn ghost" onClick={scan} disabled={busy}>재스캔</button>
        <button className="btn ghost" onClick={() => run(true)} disabled={busy || selectedItems.length === 0}>
          dry-run ({selectedItems.length})
        </button>
        <button className="btn danger" onClick={() => run(false)} disabled={busy || selectedItems.length === 0}>
          실행 — 아카이브로 이동
        </button>
      </p>

      <table>
        <thead><tr><th></th><th>경로</th><th>분류</th><th>사유</th><th className="num">크기</th><th className="num">경과</th></tr></thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.path}>
              <td>
                {c.category !== "warn-only" && (
                  <input type="checkbox" checked={checked.has(c.path)} onChange={() => toggle(c.path)} />
                )}
              </td>
              <td className="mono">{c.path}</td>
              <td>{c.category === "warn-only" ? <span className="tag warn">경고</span> : <span className="tag muted">{c.category}</span>}</td>
              <td className="muted">{c.reason}</td>
              <td className="num">{fmtSize(c.size)}</td>
              <td className="num">{c.ageDays}일</td>
            </tr>
          ))}
          {candidates.length === 0 && <tr><td colSpan={6} className="muted">정리 후보 없음</td></tr>}
        </tbody>
      </table>

      <h3>아카이브 manifest</h3>
      {manifests.map((m) => (
        <div key={m.date}>
          <h3 className="muted">{m.date} ({m.entries.length}건)</h3>
          <table>
            <thead><tr><th>원경로</th><th>사유</th><th>이동시각</th><th></th></tr></thead>
            <tbody>
              {m.entries.map((e) => (
                <tr key={e.archived + e.movedAt}>
                  <td className="mono">{e.original}</td>
                  <td className="muted">{e.reason}</td>
                  <td>{e.movedAt.slice(0, 16)}</td>
                  <td><button className="btn ghost" onClick={() => restore(e.archived)}>복구</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
