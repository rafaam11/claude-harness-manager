// DT Workbench를 흡수·재구성. 상단 바(브랜치 전환 + remote) + 리사이즈 좌측 사이드바 + 메인.
// MainArea/RemoteBar는 이 파일에 흡수했다. 상태는 useGit Context에서 받는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, RefreshCw, Upload } from "lucide-react";
import { useGit } from "./GitContext";
import ModeTabs from "./ModeTabs";
import ChangesSidebar from "./ChangesSidebar";
import GraphSidebar from "./GraphSidebar";
import CommitDetail from "./CommitDetail";
import DiffViewer from "./DiffViewer";
import EmptyChanges from "./EmptyChanges";
import BranchSwitcher from "./BranchSwitcher";
import Spinner from "./Spinner";

type LeftMode = "changes" | "history";

const PREFIX = "chm.git.";
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

/** 사이드바 폭을 [200, 640] 범위로 고정(디테일 영역 안이라 절대값으로 클램프). */
function clampSidebar(w: number): number {
  return Math.max(200, Math.min(640, w));
}

/** 메인 영역: 모드/선택에 따라 diff·커밋상세·빈상태 라우팅. */
function MainArea({
  mode,
  onShowHistory,
}: {
  mode: LeftMode;
  onShowHistory: () => void;
}): React.JSX.Element {
  const { status, selected, selectedOid } = useGit();
  if (mode === "history") {
    return selectedOid ? <CommitDetail /> : <div className="panel-placeholder">커밋을 선택하세요</div>;
  }
  if (selected) return <DiffViewer />;
  if (status && status.changedCount === 0) return <EmptyChanges onShowHistory={onShowHistory} />;
  return <div className="panel-placeholder">파일을 선택하면 변경 내용이 표시됩니다</div>;
}

/** 상단 remote 액션 바: Fetch / Pull / Push(또는 Publish) + 새로고침. 진행 중엔 스피너. */
function RemoteBar(): React.JSX.Element {
  const { status, remoteRunning, runRemote, refreshAll } = useGit();
  const upstream = status?.upstream ?? null;
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;

  return (
    <div className="git-remote-actions">
      {remoteRunning ? (
        <Spinner label="git 작업 중..." />
      ) : (
        <>
          <button className="git-rbtn" onClick={() => runRemote("fetch")} title="Fetch">
            <Download size={14} />
            Fetch
          </button>
          {behind > 0 && (
            <button className="git-rbtn" onClick={() => runRemote("pull")} title="Pull">
              <ArrowDown size={14} />
              Pull {behind}
            </button>
          )}
          {!upstream ? (
            <button className="git-rbtn" onClick={() => runRemote("publish")} title="Publish">
              <Upload size={14} />
              Publish
            </button>
          ) : (
            <button className="git-rbtn" onClick={() => runRemote("push")} title="Push">
              <ArrowUp size={14} />
              Push{ahead > 0 ? ` ${ahead}` : ""}
            </button>
          )}
        </>
      )}
      <button className="git-rbtn icon" onClick={refreshAll} title="새로고침">
        <RefreshCw size={14} />
      </button>
    </div>
  );
}

export default function GitWorkbench(): React.JSX.Element {
  const [mode, setMode] = useState<LeftMode>(() => load<LeftMode>("leftMode", "changes"));
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebar(load("sidebarWidth", 280)));
  const [resizing, setResizing] = useState(false);

  // 드래그 중 최신 폭 참조(상대 이동량 기준 리사이즈)
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    const onMove = (ev: MouseEvent): void => setSidebarWidth(clampSidebar(startW + (ev.clientX - startX)));
    const onUp = (): void => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => save("leftMode", mode), [mode]);
  useEffect(() => save("sidebarWidth", sidebarWidth), [sidebarWidth]);

  return (
    <div className="git-panel">
      <div className="git-toolbar">
        <BranchSwitcher />
        <div className="git-toolbar-spacer" />
        <RemoteBar />
      </div>
      <div
        className={resizing ? "workbench resizing" : "workbench"}
        style={{ gridTemplateColumns: `${sidebarWidth}px 1fr` }}
      >
        <aside className="panel left">
          <ModeTabs mode={mode} onModeChange={setMode} />
          {mode === "changes" ? (
            <ChangesSidebar />
          ) : (
            <GraphSidebar onShowChanges={() => setMode("changes")} />
          )}
        </aside>
        <main className="panel main">
          <div
            className={resizing ? "panel-resizer left active" : "panel-resizer left"}
            onMouseDown={startResize}
          />
          <MainArea mode={mode} onShowHistory={() => setMode("history")} />
        </main>
      </div>
    </div>
  );
}
