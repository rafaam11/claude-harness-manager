import { useEffect, useState } from "react";
import { api, fmtSize, fmtRelative } from "../api/client";

interface Candidate {
  path: string;
  category: string;
  reason: string;
  size: number;
  ageDays: number;
}

interface ManifestEntry { original: string; archived: string; reason: string; movedAt: string }
interface ManifestDay { date: string; entries: ManifestEntry[] }
interface MovePreview { from: string; category: string }

type View = "candidates" | "archive";

export default function Cleanup() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manifests, setManifests] = useState<ManifestDay[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>(
    () => (localStorage.getItem("hm-cleanup-view") as View | null) ?? "candidates",
  );
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<MovePreview[] | null>(null);
  const [archiveQuery, setArchiveQuery] = useState("");

  const scan = () => {
    setBusy(true);
    setPreview(null); // 후보가 바뀌므로 이전 dry-run 미리보기는 무효화
    api
      .post<Candidate[]>("/api/cleanup/scan")
      .then((c) => {
        setCandidates(c);
        // 재스캔 후에도 여전히 존재하는 후보의 선택은 유지(예전엔 전부 초기화).
        const paths = new Set(c.map((x) => x.path));
        setChecked((prev) => new Set([...prev].filter((p) => paths.has(p))));
      })
      .catch((e) => setMessage({ kind: "err", text: e.message }))
      .finally(() => setBusy(false));
  };

  const loadManifest = () =>
    api
      .get<ManifestDay[]>("/api/cleanup/manifest")
      .then((m) => {
        setManifests(m);
        // 최신(첫) 날짜만 기본 펼침.
        if (m.length > 0) setOpenDates((prev) => (prev.size === 0 ? new Set([m[0].date]) : prev));
      })
      .catch((e) => setMessage({ kind: "err", text: `아카이브 기록 로드 실패: ${e.message}` }));

  useEffect(() => { scan(); loadManifest(); }, []);

  const changeView = (v: View) => {
    setView(v);
    localStorage.setItem("hm-cleanup-view", v);
  };

  const movable = candidates.filter((c) => c.category !== "warn-only");
  const selectedItems = movable.filter((c) => checked.has(c.path));
  const allMovableChecked = movable.length > 0 && selectedItems.length === movable.length;

  const setMany = (paths: string[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const p of paths) on ? next.add(p) : next.delete(p);
      return next;
    });

  const toggle = (path: string) => setMany([path], !checked.has(path));
  const toggleAll = () => setMany(movable.map((c) => c.path), !allMovableChecked);

  const toggleCat = (cat: string) =>
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  const toggleDate = (date: string) =>
    setOpenDates((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });

  const run = async (dryRun: boolean) => {
    if (selectedItems.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<{ dryRun: boolean; wouldMove?: MovePreview[]; moved?: unknown[] }>(
        "/api/cleanup/execute",
        { dryRun, items: selectedItems },
      );
      if (dryRun) {
        setPreview(res.wouldMove ?? []);
        setMessage({
          kind: "warn",
          text: `dry-run: ${res.wouldMove!.length}개 항목이 이동 대상입니다. 아래 목록을 확인하고 "실행"을 누르세요.`,
        });
      } else {
        setPreview(null);
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

  const restore = async (archivedPath: string, original: string) => {
    if (!confirm(`이 항목을 원위치로 복구할까요?\n${original}`)) return;
    try {
      await api.post("/api/cleanup/restore", { archivedPath });
      setMessage({ kind: "ok", text: `복구 완료: ${original}` });
      scan();
      loadManifest();
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    }
  };

  // 후보를 분류별 그룹으로(등장 순서 유지).
  const groups: { category: string; items: Candidate[] }[] = [];
  for (const c of candidates) {
    let g = groups.find((x) => x.category === c.category);
    if (!g) { g = { category: c.category, items: [] }; groups.push(g); }
    g.items.push(c);
  }

  const q = archiveQuery.trim().toLowerCase();
  const archiveDays = manifests
    .map((m) => ({
      date: m.date,
      entries: q === "" ? m.entries : m.entries.filter((e) => e.original.toLowerCase().includes(q)),
    }))
    .filter((m) => m.entries.length > 0);

  return (
    <div>
      <h2>Cleanup</h2>
      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <div className="ws-detail-mode cleanup-mode">
        <button
          className={`ws-mode-tab${view === "candidates" ? " active" : ""}`}
          onClick={() => changeView("candidates")}
        >
          정리 후보 {movable.length > 0 && <span className="cat-count">{movable.length}</span>}
        </button>
        <button
          className={`ws-mode-tab${view === "archive" ? " active" : ""}`}
          onClick={() => changeView("archive")}
        >
          아카이브 기록
        </button>
      </div>

      {view === "candidates" ? (
        <>
          <div className="cleanup-toolbar">
            <label className="cleanup-selall">
              <input
                type="checkbox"
                checked={allMovableChecked}
                disabled={movable.length === 0}
                onChange={toggleAll}
              />
              전체 선택
            </label>
            <span className="muted cleanup-count">선택 {selectedItems.length} / {movable.length}</span>
            <span className="cleanup-toolbar-spacer" />
            <button className="btn ghost" onClick={scan} disabled={busy}>재스캔</button>
            <button
              className="btn ghost"
              onClick={() => run(true)}
              disabled={busy || selectedItems.length === 0}
            >
              dry-run ({selectedItems.length})
            </button>
            <button
              className="btn danger"
              onClick={() => run(false)}
              disabled={busy || selectedItems.length === 0}
            >
              실행 — 아카이브로 이동
            </button>
          </div>

          {preview && (
            <div className="cleanup-preview">
              <div className="sec-label">dry-run 대상 ({preview.length})</div>
              <div className="cleanup-preview-list">
                {preview.map((p) => (
                  <div className="cleanup-preview-row" key={p.from}>
                    <span className="tag muted">{p.category}</span>
                    <span className="mono cleanup-preview-path">{p.from}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <div className="muted cleanup-empty">정리 후보 없음</div>
          ) : (
            groups.map((g) => {
              const warnOnly = g.category === "warn-only";
              const open = !collapsedCats.has(g.category);
              const groupPaths = g.items.map((c) => c.path);
              const groupChecked = groupPaths.filter((p) => checked.has(p));
              const groupAll = !warnOnly && groupChecked.length === groupPaths.length;
              return (
                <div className="cleanup-group" key={g.category}>
                  <div className="cleanup-group-head">
                    <button className="cleanup-caret-btn" onClick={() => toggleCat(g.category)}>
                      <span className="cleanup-caret">{open ? "▾" : "▸"}</span>
                      {warnOnly ? (
                        <span className="tag warn">경고</span>
                      ) : (
                        <span className="tag muted">{g.category}</span>
                      )}
                      <span className="cat-count">{g.items.length}</span>
                    </button>
                    {!warnOnly && (
                      <label className="cleanup-group-all">
                        <input
                          type="checkbox"
                          checked={groupAll}
                          onChange={() => setMany(groupPaths, !groupAll)}
                        />
                        그룹 선택
                      </label>
                    )}
                  </div>
                  {open && (
                    <div className="cleanup-rows">
                      {g.items.map((c) => (
                        <label
                          className={`cleanup-row${warnOnly ? " warn-only" : ""}`}
                          key={c.path}
                        >
                          <span className="cleanup-row-check">
                            {warnOnly ? (
                              <span className="tag warn">⚠</span>
                            ) : (
                              <input
                                type="checkbox"
                                checked={checked.has(c.path)}
                                onChange={() => toggle(c.path)}
                              />
                            )}
                          </span>
                          <span className="cleanup-row-path mono">{c.path}</span>
                          <span className="cleanup-row-reason muted">{c.reason}</span>
                          <span className="cleanup-row-size num">{fmtSize(c.size)}</span>
                          <span className="cleanup-row-age num">{c.ageDays}일</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      ) : (
        <>
          <div className="cleanup-toolbar">
            <input
              className="cat-search cleanup-archive-search"
              type="text"
              placeholder="원경로 검색…"
              value={archiveQuery}
              onChange={(e) => setArchiveQuery(e.target.value)}
            />
          </div>
          {archiveDays.length === 0 ? (
            <div className="muted cleanup-empty">
              {manifests.length === 0 ? "아카이브 기록 없음" : "일치하는 기록 없음"}
            </div>
          ) : (
            archiveDays.map((m) => {
              const open = openDates.has(m.date);
              return (
                <div className="cleanup-group" key={m.date}>
                  <button className="cleanup-caret-btn cleanup-date-head" onClick={() => toggleDate(m.date)}>
                    <span className="cleanup-caret">{open ? "▾" : "▸"}</span>
                    <span className="cleanup-date">{m.date}</span>
                    <span className="cat-count">{m.entries.length}</span>
                  </button>
                  {open && (
                    <div className="cleanup-rows">
                      {m.entries.map((e) => {
                        const ms = Date.parse(e.movedAt);
                        const when = Number.isNaN(ms) ? e.movedAt.slice(0, 16) : fmtRelative(ms);
                        return (
                          <div className="cleanup-arch-row" key={e.archived + e.movedAt}>
                            <span className="cleanup-row-path mono">{e.original}</span>
                            <span className="cleanup-row-reason muted">{e.reason}</span>
                            <span className="cleanup-arch-when muted" title={e.movedAt}>{when}</span>
                            <button className="btn ghost cleanup-restore" onClick={() => restore(e.archived, e.original)}>
                              복구
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
