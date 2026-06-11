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
type Theme = "dark" | "light";

export default function App() {
  const [page, setPage] = useState<PageKey>("overview");
  const [ccRunning, setCcRunning] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("hm-theme") as Theme) || "dark",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hm-theme", theme);
  }, [theme]);

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

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <div className="layout">
      <nav>
        <div className="nav-head">
          <h1>Harness Manager</h1>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
        {(Object.keys(PAGES) as PageKey[]).map((k) => (
          <button
            key={k}
            className={`nav-item${page === k ? " active" : ""}`}
            onClick={() => setPage(k)}
          >
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
