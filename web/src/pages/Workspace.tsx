import { useEffect, useMemo, useState } from "react";
import { marked } from "marked";
import { api, fmtDate, fmtRelative } from "../api/client";

// --- 서버와 공유되는 형태 ---
type BoardStatus = "진행중" | "보류" | "완료" | "보관";
const STATUSES: BoardStatus[] = ["진행중", "보류", "완료", "보관"];

interface SessionRecall {
  sessionId: string | null;
  aiTitle: string | null;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  cwd: string | null;
  gitBranch: string | null;
  transcriptMtime: number;
  truncatedScan: boolean;
}
interface SessionTodos {
  total: number;
  done: number;
  items: { id: string; subject: string; status: string }[];
}
interface WorkspaceProject {
  id: string;
  realPath: string | null;
  gitBranch: string | null;
  lastActivity: number;
  staleDays: number;
  recall: SessionRecall | null;
  todos: SessionTodos | null;
  board: { status: BoardStatus | null; memo: string };
  plans: { filename: string; title: string; status: BoardStatus; archived: boolean }[];
}
interface EnrichedPlan {
  filename: string;
  title: string;
  mtime: number;
  archived: boolean;
  guessedProjectId: string | null;
  projectOverride: string | null;
  projectId: string | null;
  status: BoardStatus;
  memo: string;
}
interface TimelineEvent {
  ts: number;
  kind: "session" | "plan";
  projectId: string | null;
  realPath: string | null;
  title: string;
  filename?: string;
}

const SUBS = {
  projects: "Projects",
  plans: "Plans",
  timeline: "Timeline",
} as const;
type SubKey = keyof typeof SUBS;

/** flatten된 id / 실제 경로에서 사람이 읽을 짧은 이름 */
function shortName(realPath: string | null, id: string): string {
  if (realPath) {
    const parts = realPath.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return id.replace(/^[A-Za-z]--/, "").replace(/-/g, "/");
}

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
      {sub === "timeline" && <TimelineView />}
    </div>
  );
}

// ============================ Projects ============================
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

  async function patch(id: string, body: { status?: BoardStatus; memo?: string }) {
    // 낙관적 업데이트
    setProjects((prev) =>
      prev
        ? prev.map((p) =>
            p.id === id ? { ...p, board: { ...p.board, ...body } } : p,
          )
        : prev,
    );
    try {
      await api.post(`/api/workspace/board/project/${encodeURIComponent(id)}`, body);
    } catch (e) {
      setError((e as Error).message);
      load(); // 실패 시 서버 상태로 재동기화
    }
  }

  if (error) return <div className="banner err">{error}</div>;
  if (!projects) return <div className="muted">불러오는 중…</div>;
  if (projects.length === 0) return <div className="muted">프로젝트 기록이 없습니다.</div>;

  return (
    <div className="ws-list">
      {projects.map((p) => (
        <ProjectCard key={p.id} p={p} onPatch={patch} />
      ))}
    </div>
  );
}

function ProjectCard({
  p,
  onPatch,
}: {
  p: WorkspaceProject;
  onPatch: (id: string, body: { status?: BoardStatus; memo?: string }) => void;
}) {
  const r = p.recall;
  return (
    <div className="ws-card">
      <div className="ws-card-head">
        <span className="ws-title">{shortName(p.realPath, p.id)}</span>
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

      <div className="ws-chips">
        {p.todos && (
          <span className={`tag ${p.todos.done === p.todos.total ? "ok" : "muted"}`}>
            ✓ 할일 {p.todos.done}/{p.todos.total}
          </span>
        )}
        {p.plans.map((pl) => (
          <span className="ws-planchip" key={pl.filename} title={pl.title}>
            <StatusTag s={pl.status} />
            <span className="ws-planchip-t">{pl.title}</span>
          </span>
        ))}
      </div>

      <MemoBox
        value={p.board.memo}
        placeholder="어디까지 했나 / 다음 할 일…"
        onSave={(memo) => onPatch(p.id, { memo })}
      />
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

  const projName = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) m.set(p.id, shortName(p.realPath, p.id));
    return m;
  }, [projects]);

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
              {shortName(pr.realPath, pr.id)}
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

// ============================ Timeline ============================
function TimelineView() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<TimelineEvent[]>("/api/workspace/timeline")
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="banner err">{error}</div>;
  if (!events) return <div className="muted">불러오는 중…</div>;
  if (events.length === 0) return <div className="muted">활동 기록이 없습니다.</div>;

  // 날짜별 그룹
  const groups: { day: string; ms: number; items: TimelineEvent[] }[] = [];
  for (const e of events) {
    const day = fmtDate(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, ms: e.ts, items: [e] });
  }

  return (
    <div className="timeline">
      {groups.map((g, i) => {
        const prev = groups[i - 1];
        const gapDays = prev
          ? Math.round(
              (new Date(prev.day).getTime() - new Date(g.day).getTime()) / 86400000,
            )
          : 0;
        return (
          <div key={g.day}>
            {gapDays > 1 && <div className="timeline-gap">· {gapDays - 1}일 공백 ·</div>}
            <div className="timeline-day">{g.day}</div>
            {g.items.map((e, j) => (
              <div className="timeline-item" key={j}>
                <span className={`bdg ${e.kind === "plan" ? "bdg-plan" : "bdg-session"}`}>
                  {e.kind === "plan" ? "PLAN" : "SESS"}
                </span>
                <span className="timeline-title">{e.title}</span>
                <span className="timeline-proj muted">
                  {e.projectId ? shortName(e.realPath, e.projectId) : ""}
                </span>
              </div>
            ))}
          </div>
        );
      })}
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
