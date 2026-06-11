import { useEffect, useState } from "react";
import { api } from "./api/client";
import Overview from "./pages/Overview";
import Catalog from "./pages/Catalog";
import Memory from "./pages/Memory";
import Cleanup from "./pages/Cleanup";
import ConfigEditor from "./pages/ConfigEditor";

const PAGES = {
  overview: { label: "Overview", el: <Overview /> },
  catalog: { label: "Catalog", el: <Catalog /> },
  memory: { label: "Memory", el: <Memory /> },
  cleanup: { label: "Cleanup", el: <Cleanup /> },
  configs: { label: "Config Editor", el: <ConfigEditor /> },
} as const;

type PageKey = keyof typeof PAGES;

export default function App() {
  const [page, setPage] = useState<PageKey>("overview");
  const [ccRunning, setCcRunning] = useState(false);

  useEffect(() => {
    const check = () =>
      api
        .get<{ running: boolean }>("/api/cc-status")
        .then((s) => setCcRunning(s.running))
        .catch(() => {});
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="layout">
      <nav>
        <h1>Harness Manager</h1>
        {(Object.keys(PAGES) as PageKey[]).map((k) => (
          <button key={k} className={page === k ? "active" : ""} onClick={() => setPage(k)}>
            {PAGES[k].label}
          </button>
        ))}
      </nav>
      <main>
        {ccRunning && (
          <div className="banner warn">
            Claude Code 세션이 실행 중입니다 — 설정 저장·정리 실행 시 충돌에 주의하세요.
          </div>
        )}
        {PAGES[page].el}
      </main>
    </div>
  );
}
