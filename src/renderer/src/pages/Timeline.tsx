import { useEffect, useMemo, useState } from "react";
import { api, fmtDate } from "../api/client";
import {
  buildProjNameMap,
  shortName,
  type TimelineEvent,
  type WorkspaceProject,
} from "./workspace-shared";

// 날짜별 세션/계획 이벤트 타임라인. "N일 공백" 구분선으로 주말 갭을 가시화한다.
export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<TimelineEvent[]>("/api/workspace/timeline")
      .then(setEvents)
      .catch((e) => setError(e.message));
    api
      .get<WorkspaceProject[]>("/api/workspace/projects")
      .then(setProjects)
      .catch(() => {});
  }, []);

  // projectId → 표시 이름(nameOverride 반영). 같은 프로젝트면 session/plan 이벤트가 동일 이름을 쓴다.
  const projName = useMemo(() => buildProjNameMap(projects), [projects]);

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

  const label = (e: TimelineEvent) =>
    e.projectId ? projName.get(e.projectId) ?? shortName(e.realPath, e.projectId) : "";

  return (
    <div>
      <h2>Timeline</h2>
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
                  <span className="timeline-proj muted">{label(e)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
