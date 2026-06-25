import { useEffect, useState } from "react";
import { api } from "./api/client";
import Timeline from "./pages/Timeline";
import Workspace from "./pages/Workspace";
import Catalog from "./pages/Catalog";
import Cleanup from "./pages/Cleanup";
import ConfigEditor from "./pages/ConfigEditor";
import News from "./pages/News";
import UpdateBadge from "./components/UpdateBadge";

const PAGES = {
  timeline: { label: "Timeline", el: <Timeline /> },
  workspace: { label: "Workspace", el: <Workspace /> },
  catalog: { label: "Catalog", el: <Catalog /> },
  cleanup: { label: "Cleanup", el: <Cleanup /> },
  configs: { label: "Config Editor", el: <ConfigEditor /> },
  news: { label: "News", el: <News /> },
} as const;

type PageKey = keyof typeof PAGES;
type Theme = "dark" | "light";

// nav 렌더 그룹. PAGES는 평면 유지(PageKey 추론·PAGES[page].el 보존), 순서/그룹 구분만 여기서.
const PRIMARY_PAGES: PageKey[] = ["timeline", "workspace", "catalog", "cleanup", "configs"];
const SECONDARY_PAGES: PageKey[] = ["news"];

export default function App() {
  const [page, setPage] = useState<PageKey>("timeline");
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
        {PRIMARY_PAGES.map((k) => (
          <button
            key={k}
            className={`nav-item${page === k ? " active" : ""}`}
            onClick={() => setPage(k)}
          >
            {PAGES[k].label}
          </button>
        ))}
        <div className="nav-divider" />
        {SECONDARY_PAGES.map((k) => (
          <button
            key={k}
            className={`nav-item${page === k ? " active" : ""}`}
            onClick={() => setPage(k)}
          >
            {PAGES[k].label}
          </button>
        ))}
        <div className="nav-spacer" />
        <UpdateBadge />
      </nav>
      <main className={page === "workspace" ? "page-wide" : undefined}>
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
