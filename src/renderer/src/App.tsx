import { useEffect, useState } from "react";
import { api } from "./api/client";
import Timeline from "./pages/Timeline";
import Workspace from "./pages/Workspace";
import Catalog from "./pages/Catalog";
import Cleanup from "./pages/Cleanup";
import ConfigEditor from "./pages/ConfigEditor";
import News from "./pages/News";
import Glossary from "./pages/Glossary";
import UpdateBadge from "./components/UpdateBadge";
import type { ProviderFilter, ProviderStatus } from "@shared/provider-types";
import { providerLabel } from "./pages/workspace-shared";

const PAGES = {
  timeline: { label: "타임라인" },
  workspace: { label: "워크스페이스" },
  catalog: { label: "카탈로그" },
  cleanup: { label: "정리" },
  configs: { label: "설정 편집기" },
  news: { label: "뉴스" },
  glossary: { label: "용어집" },
} as const;

const PROVIDER_FILTERS: { value: ProviderFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
];

type PageKey = keyof typeof PAGES;
type Theme = "dark" | "light";

const PRIMARY_PAGES: PageKey[] = ["timeline", "workspace", "catalog", "cleanup", "configs"];
const SECONDARY_PAGES: PageKey[] = ["news", "glossary"];
const WIDE_PAGES: PageKey[] = ["workspace", "catalog", "glossary", "news"];

export default function App() {
  const [page, setPage] = useState<PageKey>("timeline");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("hm-theme") as Theme) || "dark",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hm-theme", theme);
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const statuses = await api.get<ProviderStatus[]>("/api/provider/status");
      if (alive) setProviderStatuses(statuses);
    };
    load().catch(() => {});
    const id = window.setInterval(() => load().catch(() => {}), 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");
  const runningProviders = providerStatuses.filter((status) => status.running);

  const renderPage = () => {
    switch (page) {
      case "timeline":
        return <Timeline providerFilter={providerFilter} />;
      case "workspace":
        return <Workspace providerFilter={providerFilter} />;
      case "catalog":
        return <Catalog providerFilter={providerFilter} />;
      case "cleanup":
        return <Cleanup />;
      case "configs":
        return <ConfigEditor providerFilter={providerFilter} />;
      case "news":
        return <News />;
      case "glossary":
        return <Glossary />;
      default:
        return null;
    }
  };

  return (
    <div className="layout">
      <nav>
        <div className="nav-head">
          <h1>하네스 매니저</h1>
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
        <div className="nav-provider">
          <div className="nav-provider-label">Provider</div>
          <div className="provider-filter" role="tablist" aria-label="Provider filter">
            {PROVIDER_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                className={providerFilter === value ? "active" : ""}
                onClick={() => setProviderFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="nav-spacer" />
        <UpdateBadge />
      </nav>
      <main className={WIDE_PAGES.includes(page) ? "page-wide" : undefined}>
        {runningProviders.length > 0 && (
          <div className="banner warn">
            실행 중인 provider: {runningProviders.map((status) => providerLabel(status.id)).join(", ")} —
            설정 저장·정리 실행 시 충돌에 주의하세요.
          </div>
        )}
        {renderPage()}
      </main>
    </div>
  );
}
