import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { api, fmtDate, fmtRelative } from "../api/client";
import {
  STATUSES,
  buildProjNameMap,
  displayName,
  shortName,
  type BoardStatus,
  type EnrichedPlan,
  type ProjectTrack,
  type WorkspaceProject,
} from "./workspace-shared";

const SUBS = {
  projects: "Projects",
  plans: "Plans",
} as const;
type SubKey = keyof typeof SUBS;

function StatusTag({ s }: { s: BoardStatus }) {
  return <span className={`tag st-${STATUSES.indexOf(s)}`}>{s}</span>;
}

export default function Workspace() {
  const [sub, setSub] = useState<SubKey>("projects");
  return (
    <div>
      <h2>Workspace</h2>
      <div className="ws-subtabs">
        {(Object.keys(SUBS) as SubKey[]).map((k) => (
          <button
            key={k}
            className={`ws-subtab${sub === k ? " active" : ""}`}
            onClick={() => setSub(k)}
          >
            {SUBS[k]}
          </button>
        ))}
      </div>
      {sub === "projects" && <ProjectsView />}
      {sub === "plans" && <PlansView />}
    </div>
  );
}

// ============================ Projects ============================
type ProjectPatch = {
  status?: BoardStatus;
  memo?: string;
  nameOverride?: string | null;
  tracks?: ProjectTrack[];
};

function ProjectsView() {
  const [projects, setProjects] = useState<WorkspaceProject[] | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    api
      .get<WorkspaceProject[]>("/api/workspace/projects")
      .then(setProjects)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function patch(id: string, body: ProjectPatch) {
    // 낙관적 업데이트. body의 nameOverride는 해제용 null을 쓰므로 board(string)에는 ""로 정규화.
    const boardPatch: Partial<WorkspaceProject["board"]> = {};
    if (body.status !== undefined) boardPatch.status = body.status;
    if (body.memo !== undefined) boardPatch.memo = body.memo;
    if (body.nameOverride !== undefined) boardPatch.nameOverride = body.nameOverride ?? "";
    if (body.tracks !== undefined) boardPatch.tracks = body.tracks;
    setProjects((prev) =>
      prev
        ? prev.map((p) => (p.id === id ? { ...p, board: { ...p.board, ...boardPatch } } : p))
        : prev,
    );
    try {
      await api.post(`/api/workspace/board/project/${encodeURIComponent(id)}`, body);
    } catch (e) {
      setError((e as Error).message);
      load(); // 실패 시 서버 상태로 재동기화
    }
  }

  async function openFolder(realPath: string) {
    try {
      const msg = await window.app.openPath(realPath);
      if (msg) setError(`폴더 열기 실패: ${msg}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error) return <div className="banner err">{error}</div>;
  if (!projects) return <div className="muted">불러오는 중…</div>;
  if (projects.length === 0) return <div className="muted">프로젝트 기록이 없습니다.</div>;

  return (
    <div className="ws-list">
      {projects.map((p) => (
        <ProjectCard key={p.id} p={p} onPatch={patch} onOpenFolder={openFolder} />
      ))}
    </div>
  );
}

function ProjectCard({
  p,
  onPatch,
  onOpenFolder,
}: {
  p: WorkspaceProject;
  onPatch: (id: string, body: ProjectPatch) => void;
  onOpenFolder: (realPath: string) => void;
}) {
  const r = p.recall;
  const base = shortName(p.realPath, p.id);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const startEditName = () => {
    setNameDraft(p.board.nameOverride || "");
    setEditingName(true);
  };
  const saveName = () => {
    setEditingName(false);
    onPatch(p.id, { nameOverride: nameDraft.trim() || null });
  };

  const [tracksOpen, setTracksOpen] = useState(false);
  const totalTodos = p.board.tracks.reduce((n, t) => n + t.items.length, 0);
  const doneTodos = p.board.tracks.reduce((n, t) => n + t.items.filter((i) => i.done).length, 0);

  return (
    <div className="ws-card">
      <div className="ws-card-head">
        {editingName ? (
          <>
            <input
              className="ws-title-input"
              autoFocus
              value={nameDraft}
              placeholder={base}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                else if (e.key === "Escape") setEditingName(false);
              }}
            />
            <button className="ws-icon-btn" onClick={saveName} title="저장">
              ✓
            </button>
            <button className="ws-icon-btn" onClick={() => setEditingName(false)} title="취소">
              ✕
            </button>
          </>
        ) : (
          <>
            <span className="ws-title">{displayName(p)}</span>
            <button className="ws-icon-btn" onClick={startEditName} title="이름 변경">
              ✎
            </button>
            {p.realPath && (
              <button
                className="ws-icon-btn"
                onClick={() => onOpenFolder(p.realPath!)}
                title="폴더 열기"
              >
                📂
              </button>
            )}
          </>
        )}
        {p.gitBranch && <span className="t-tag">⎇ {p.gitBranch}</span>}
        <span className="ws-when">{fmtRelative(p.lastActivity)}</span>
        <select
          className="ws-select"
          value={p.board.status ?? ""}
          onChange={(e) =>
            onPatch(p.id, { status: (e.target.value || "진행중") as BoardStatus })
          }
        >
          <option value="">상태 없음</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="ws-path mono">{p.realPath ?? p.id}</div>

      {r ? (
        <div className="ws-recall">
          {r.aiTitle && <div className="ws-aititle">📌 {r.aiTitle}</div>}
          {r.lastPrompt && (
            <div className="ws-line">
              <span className="ws-line-k">마지막 입력</span> {r.lastPrompt}
            </div>
          )}
          {r.lastAssistantSnippet && (
            <div className="ws-line">
              <span className="ws-line-k">마지막 응답</span> {r.lastAssistantSnippet}
            </div>
          )}
        </div>
      ) : (
        <div className="muted ws-recall">최근 세션 기록 없음</div>
      )}

      {p.todos && (
        <div className="ws-chips">
          <span className={`tag ${p.todos.done === p.todos.total ? "ok" : "muted"}`}>
            ✓ 할일 {p.todos.done}/{p.todos.total}
          </span>
        </div>
      )}

      <MemoBox
        value={p.board.memo}
        placeholder="어디까지 했나 / 다음 할 일…"
        onSave={(memo) => onPatch(p.id, { memo })}
      />

      <button
        className="ws-link"
        onClick={() => setTracksOpen(!tracksOpen)}
        title="작업 갈래별 할 일 체크리스트"
      >
        {tracksOpen
          ? "트랙 닫기 ▴"
          : `트랙 / 할 일${totalTodos ? ` (${doneTodos}/${totalTodos})` : ""} ▾`}
      </button>
      {tracksOpen && (
        <TrackEditor
          tracks={p.board.tracks}
          onSave={(tracks) => onPatch(p.id, { tracks })}
        />
      )}
    </div>
  );
}

// ============================ 트랙 / 할 일 ============================
type SaveState = "idle" | "editing" | "saved";

/** 두 트랙 배열의 내용이 같은지(얕은 비교). 외부 변경 감지 / 내 저장 에코 식별에 쓴다. */
function sameTracks(a: ProjectTrack[], b: ProjectTrack[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.title !== y.title || x.items.length !== y.items.length) return false;
    for (let j = 0; j < x.items.length; j++) {
      const p = x.items[j];
      const q = y.items[j];
      if (p.id !== q.id || p.text !== q.text || p.done !== q.done) return false;
    }
  }
  return true;
}

function TrackEditor({
  tracks,
  onSave,
}: {
  tracks: ProjectTrack[];
  onSave: (tracks: ProjectTrack[]) => void;
}) {
  // 단일 저장 모델: 텍스트는 700ms 디바운스, 구조 변경(추가/삭제/토글)·blur는 즉시 flush.
  const [draft, setDraft] = useState(tracks);
  const [focusId, setFocusId] = useState<string | null>(null); // 방금 추가한 트랙/할 일에 포커스
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const dirtyRef = useRef(false); // 로컬 미저장 편집 존재
  const pendingRef = useRef<ProjectTrack[] | null>(null); // 방금 보낸 값(낙관적 에코 식별)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // 진짜 외부 변경(서버 재동기화)만 draft에 반영. 타이핑 중·내 저장 에코는 무시(기존 리셋 버그 차단).
  useEffect(() => {
    if (dirtyRef.current) return;
    if (sameTracks(tracks, pendingRef.current)) return;
    setDraft(tracks);
  }, [tracks]);

  // 언마운트(트랙 패널 접기 등) 시 미저장 텍스트 flush
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        onSaveRef.current(draftRef.current);
      }
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const flushSave = (next: ProjectTrack[]) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingRef.current = next;
    dirtyRef.current = false;
    onSave(next);
    setSaveState("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 2000);
  };
  const scheduleSave = (next: ProjectTrack[]) => {
    setDraft(next);
    dirtyRef.current = true;
    setSaveState("editing");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushSave(next), 700);
  };
  const commitNow = (next: ProjectTrack[]) => {
    setDraft(next);
    flushSave(next);
  };
  const flushNow = () => {
    if (saveTimer.current) flushSave(draftRef.current);
  };

  const updateTrack = (id: string, patch: Partial<ProjectTrack>, immediate: boolean) => {
    const next = draft.map((t) => (t.id === id ? { ...t, ...patch } : t));
    immediate ? commitNow(next) : scheduleSave(next);
  };
  const addTrack = () => {
    const id = crypto.randomUUID();
    setFocusId(id);
    commitNow([...draft, { id, title: "", items: [] }]);
  };
  const removeTrack = (id: string) => commitNow(draft.filter((t) => t.id !== id));

  return (
    <div className="ws-tracks">
      {draft.map((t) => (
        <TrackRow
          key={t.id}
          track={t}
          focusId={focusId}
          requestFocus={setFocusId}
          onTitle={(title) => updateTrack(t.id, { title }, false)}
          onItems={(items, immediate) => updateTrack(t.id, { items }, immediate)}
          onRemove={() => removeTrack(t.id)}
          onFlush={flushNow}
        />
      ))}
      {draft.length === 0 && (
        <p className="ws-track-hint">
          트랙 = 이 프로젝트의 작업 갈래(예: 백엔드 / 리팩터). 갈래별로 할 일을 묶어요. 가벼운 진행
          메모는 위 메모 칸, 긴 설계는 Plans를 쓰세요.
        </p>
      )}
      <div className="ws-track-foot">
        <button className="ws-track-add" onClick={addTrack}>
          + 트랙 추가
        </button>
        <span className={`ws-save-cue${saveState === "idle" ? " hidden" : ""}`}>
          {saveState === "editing" ? "편집 중…" : saveState === "saved" ? "저장됨 ✓" : ""}
        </span>
      </div>
    </div>
  );
}

function TrackRow({
  track,
  focusId,
  requestFocus,
  onTitle,
  onItems,
  onRemove,
  onFlush,
}: {
  track: ProjectTrack;
  focusId: string | null;
  requestFocus: (id: string) => void;
  onTitle: (title: string) => void;
  onItems: (items: ProjectTrack["items"], immediate: boolean) => void;
  onRemove: () => void;
  onFlush: () => void;
}) {
  const [open, setOpen] = useState(true);
  const done = track.items.filter((i) => i.done).length;
  const total = track.items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const setItem = (id: string, patch: { text?: string; done?: boolean }, immediate: boolean) =>
    onItems(
      track.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      immediate,
    );
  const addItem = () => {
    const id = crypto.randomUUID();
    requestFocus(id);
    onItems([...track.items, { id, text: "", done: false }], true);
  };
  const removeItem = (id: string) =>
    onItems(
      track.items.filter((i) => i.id !== id),
      true,
    );

  return (
    <div className="ws-track">
      <div className="ws-track-head">
        <button className="ws-track-toggle" onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"}
        </button>
        <input
          className="ws-track-title"
          value={track.title}
          placeholder="트랙 이름"
          autoFocus={focusId === track.id}
          onChange={(e) => onTitle(e.target.value)}
          onBlur={onFlush}
        />
        {total > 0 && (
          <>
            <div className="ws-track-bar" title={`${done}/${total}`}>
              <span className={pct === 100 ? "full" : ""} style={{ width: `${pct}%` }} />
            </div>
            <span className="ws-track-count muted">
              {done}/{total}
            </span>
          </>
        )}
        <button className="ws-icon-btn" onClick={onRemove} title="트랙 삭제">
          🗑
        </button>
      </div>
      {open && (
        <div className="ws-track-items">
          {track.items.map((i) => (
            <div className="ws-todo" key={i.id}>
              <input
                type="checkbox"
                checked={i.done}
                onChange={(e) => setItem(i.id, { done: e.target.checked }, true)}
              />
              <input
                className={`ws-todo-text${i.done ? " done" : ""}`}
                value={i.text}
                placeholder="할 일…"
                autoFocus={focusId === i.id}
                onChange={(e) => setItem(i.id, { text: e.target.value }, false)}
                onBlur={onFlush}
              />
              <button className="ws-icon-btn" onClick={() => removeItem(i.id)} title="삭제">
                ✕
              </button>
            </div>
          ))}
          <button className="ws-todo-add" onClick={addItem}>
            + 할 일 추가
          </button>
        </div>
      )}
    </div>
  );
}

// ============================ Plans (칸반) ============================
function PlansView() {
  const [plans, setPlans] = useState<EnrichedPlan[] | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [error, setError] = useState("");

  const load = (arch: boolean) => {
    api
      .get<EnrichedPlan[]>(`/api/workspace/plans?archived=${arch ? 1 : 0}`)
      .then(setPlans)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    load(includeArchived);
  }, [includeArchived]);
  useEffect(() => {
    api
      .get<WorkspaceProject[]>("/api/workspace/projects")
      .then(setProjects)
      .catch(() => {});
  }, []);

  const projName = useMemo(() => buildProjNameMap(projects), [projects]);

  async function patch(
    filename: string,
    body: { status?: BoardStatus; memo?: string; projectOverride?: string | null },
  ) {
    setPlans((prev) =>
      prev ? prev.map((p) => (p.filename === filename ? applyPlanPatch(p, body) : p)) : prev,
    );
    try {
      await api.post(`/api/workspace/board/plan/${encodeURIComponent(filename)}`, body);
    } catch (e) {
      setError((e as Error).message);
      load(includeArchived);
    }
  }

  function applyPlanPatch(p: EnrichedPlan, body: Parameters<typeof patch>[1]): EnrichedPlan {
    const next = { ...p };
    if (body.status) next.status = body.status;
    if (body.memo !== undefined) next.memo = body.memo;
    if (body.projectOverride !== undefined) {
      next.projectOverride = body.projectOverride || null;
      next.projectId = next.projectOverride ?? p.guessedProjectId;
    }
    return next;
  }

  if (error) return <div className="banner err">{error}</div>;
  if (!plans) return <div className="muted">불러오는 중…</div>;

  // 컬럼 = 파일이 _archive면 항상 "보관", 아니면 board 상태
  const col = (p: EnrichedPlan): BoardStatus => (p.archived ? "보관" : p.status);

  return (
    <div>
      <label className="ws-toggle">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        보관된 계획 포함
      </label>
      <div className="kanban">
        {STATUSES.map((st) => {
          const items = plans.filter((p) => col(p) === st);
          return (
            <div className="kanban-col" key={st}>
              <h4>
                <StatusTag s={st} /> <span className="cat-count">{items.length}</span>
              </h4>
              {items.map((p) => (
                <PlanCard
                  key={p.filename}
                  p={p}
                  projects={projects}
                  projName={projName}
                  onPatch={patch}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlanCard({
  p,
  projects,
  projName,
  onPatch,
}: {
  p: EnrichedPlan;
  projects: WorkspaceProject[];
  projName: Map<string, string>;
  onPatch: (
    filename: string,
    body: { status?: BoardStatus; memo?: string; projectOverride?: string | null },
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const guessedName = p.guessedProjectId
    ? projName.get(p.guessedProjectId) ?? p.guessedProjectId
    : "없음";

  async function toggleBody() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (body === null) {
      try {
        const c = await api.get<{ raw: string }>(
          `/api/workspace/plan/content?filename=${encodeURIComponent(p.filename)}&archived=${
            p.archived ? 1 : 0
          }`,
        );
        setBody(c.raw);
      } catch {
        setBody("(본문을 불러오지 못했습니다)");
      }
    }
  }

  return (
    <div className="kanban-card">
      <div className="kanban-card-title">
        {p.archived && <span className="t-tag">📦</span>} {p.title}
      </div>
      <div className="kanban-card-meta">{fmtDate(p.mtime)}</div>

      <div className="kanban-card-row">
        <select
          className="ws-select grow"
          value={p.projectOverride ?? ""}
          onChange={(e) => onPatch(p.filename, { projectOverride: e.target.value || null })}
          title="연결된 프로젝트 (수동 지정)"
        >
          <option value="">자동: {guessedName}</option>
          {projects.map((pr) => (
            <option key={pr.id} value={pr.id}>
              {displayName(pr)}
            </option>
          ))}
        </select>
        {!p.archived && (
          <select
            className="ws-select"
            value={p.status}
            onChange={(e) => onPatch(p.filename, { status: e.target.value as BoardStatus })}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <MemoBox
        value={p.memo}
        placeholder="메모…"
        onSave={(memo) => onPatch(p.filename, { memo })}
      />

      <button className="ws-link" onClick={toggleBody}>
        {open ? "본문 닫기 ▴" : "본문 보기 ▾"}
      </button>
      {open && (
        <div
          className="md-body ws-planbody"
          dangerouslySetInnerHTML={{
            __html: marked.parse(body ?? "불러오는 중…") as string,
          }}
        />
      )}
    </div>
  );
}

// ============================ 공용: 메모 편집 ============================
function MemoBox({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (memo: string) => void;
}) {
  const [text, setText] = useState(value);
  // 외부 값이 바뀌면(재동기화) 반영
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <textarea
      className="ws-memo"
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onSave(text);
      }}
    />
  );
}
