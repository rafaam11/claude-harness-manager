import { useEffect, useState } from "react";
import { api } from "../api/client";

interface OverviewData {
  skills: number;
  agents: number;
  commands: number;
  agentWarnings: number;
  plugins: number;
  projects: number;
  staleProjects: number;
  cleanupCandidates: number;
  lastAudit: string | null;
  ccRunning: boolean;
}

export default function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<OverviewData>("/api/overview").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="banner err">{error}</div>;
  if (!data) return <p className="muted">불러오는 중…</p>;

  const cards: { label: string; value: string | number; warn?: boolean }[] = [
    { label: "개인 스킬", value: data.skills },
    { label: "커스텀 에이전트", value: data.agents },
    { label: "Slash 커맨드", value: data.commands },
    { label: "플러그인", value: data.plugins },
    { label: "프로젝트 데이터", value: data.projects },
    { label: "Stale 프로젝트 (30d+)", value: data.staleProjects, warn: data.staleProjects > 0 },
    { label: "정리 후보", value: data.cleanupCandidates, warn: data.cleanupCandidates > 0 },
    { label: "에이전트 크기 경고", value: data.agentWarnings, warn: data.agentWarnings > 0 },
    { label: "마지막 하네스 점검", value: data.lastAudit ?? "-" },
  ];

  return (
    <div>
      <h2>Overview</h2>
      <div className="cards">
        {cards.map((c) => (
          <div key={c.label} className={`card${c.warn ? " warn" : ""}`}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
