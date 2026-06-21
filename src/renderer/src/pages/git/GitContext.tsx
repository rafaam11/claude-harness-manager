// DT의 zustand store(repo/changes/graph) 3개를 합친 Git 영역 한정 Context.
// projectId를 보유하고 모든 액션을 projectId 기준으로 수행한다(액션 인자에 repoId 없음).
// GitPanel이 <GitProvider key={projectId}>로 마운트하므로 프로젝트 전환 = 통째 리마운트라
// DT store의 reset/loadedRepoId 분기 로직이 전부 불필요해진다. 빠른 클릭 race는 seq ref로 막는다.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../api/client";
import { layoutGraph, type GraphLayout } from "../../git/graphLayout";
import type {
  BranchListResult,
  CommitDetail,
  CommitDetailResult,
  CommitFileChange,
  CommitNode,
  DiffResult,
  GitActionResult,
  GitOpKind,
  GitOpResult,
  GraphActionRequest,
  GraphPayload,
  InProgressResult,
  InProgressState,
  RepoStatus,
  StatusEntryKind,
} from "@shared/types";

/** 그래프 액션 요청(projectId는 Context가 채운다). */
export type ActionReq = Omit<GraphActionRequest, "projectId">;

interface GitContextValue {
  projectId: string;
  // 상태(status)
  status: RepoStatus | null;
  statusLoading: boolean;
  // Changes diff 선택
  selected: { path: string; staged: boolean } | null;
  diff: DiffResult | null;
  diffLoading: boolean;
  // 커밋 초안
  summary: string;
  description: string;
  setSummary: (s: string) => void;
  setDescription: (s: string) => void;
  // 그래프
  commits: CommitNode[];
  layout: GraphLayout | null;
  headOid: string | null;
  truncated: boolean;
  graphLoading: boolean;
  // 커밋 상세
  selectedOid: string | null;
  detail: CommitDetail | null;
  detailLoading: boolean;
  selectedFile: string | null;
  fileDiff: DiffResult | null;
  fileDiffLoading: boolean;
  // 진행 중 작업 / remote
  inProgress: InProgressState;
  remoteRunning: boolean;
  // 액션
  refreshAll: () => void;
  selectFile: (path: string, staged: boolean, kind: StatusEntryKind) => void;
  stage: (paths: string[]) => void;
  unstage: (paths: string[]) => void;
  discard: (paths: string[]) => void;
  commit: () => void;
  selectCommit: (oid: string) => void;
  selectCommitFile: (file: CommitFileChange) => void;
  runAction: (req: ActionReq) => void;
  runRemote: (kind: GitOpKind) => void;
  listBranches: () => Promise<BranchListResult>;
}

const GitContext = createContext<GitContextValue | null>(null);

export function useGit(): GitContextValue {
  const ctx = useContext(GitContext);
  if (!ctx) throw new Error("useGit must be used within GitProvider");
  return ctx;
}

const q = encodeURIComponent;

export function GitProvider({
  projectId,
  onError,
  children,
}: {
  projectId: string;
  onError: (message: string) => void;
  children: ReactNode;
}): React.JSX.Element {
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const [headOid, setHeadOid] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [graphLoading, setGraphLoading] = useState(true);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileDiff, setFileDiff] = useState<DiffResult | null>(null);
  const [fileDiffLoading, setFileDiffLoading] = useState(false);
  const [inProgress, setInProgress] = useState<InProgressState>({ kind: null });
  const [remoteRunning, setRemoteRunning] = useState(false);

  // 최신값 참조용 ref(클로저/seq race 대응)
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const fail = useCallback((m: string) => onErrorRef.current(m), []);
  const diffSeq = useRef(0);
  const detailSeq = useRef(0);
  const fileDiffSeq = useRef(0);
  const graphSeq = useRef(0);
  const detailRef = useRef<CommitDetail | null>(null);
  detailRef.current = detail;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectedOidRef = useRef(selectedOid);
  selectedOidRef.current = selectedOid;
  const remoteRunningRef = useRef(remoteRunning);
  remoteRunningRef.current = remoteRunning;

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const s = await api.get<RepoStatus>(`/api/git/status?projectId=${q(projectId)}`);
      setStatus(s);
    } catch (e) {
      setStatus(null);
      fail((e as Error).message);
    } finally {
      setStatusLoading(false);
    }
  }, [projectId, fail]);

  const loadGraph = useCallback(async () => {
    const seq = ++graphSeq.current;
    setGraphLoading(true);
    try {
      const r = await api.get<GraphPayload>(`/api/git/graph?projectId=${q(projectId)}`);
      if (graphSeq.current !== seq) return;
      if (!r.ok) {
        fail(r.message);
        setGraphLoading(false);
        return;
      }
      setCommits(r.commits);
      setLayout(layoutGraph(r.commits));
      setHeadOid(r.headOid);
      setTruncated(r.truncated);
      // 선택했던 커밋이 사라졌으면(reset/rebase 등) 상세 선택을 비운다
      const sel = selectedOidRef.current;
      if (sel && !r.commits.some((c) => c.oid === sel)) {
        setSelectedOid(null);
        setDetail(null);
        setSelectedFile(null);
        setFileDiff(null);
      }
      setGraphLoading(false);
    } catch (e) {
      if (graphSeq.current === seq) {
        fail((e as Error).message);
        setGraphLoading(false);
      }
    }
  }, [projectId, fail]);

  const refreshInProgress = useCallback(async () => {
    try {
      const r = await api.get<InProgressResult>(`/api/git/in-progress?projectId=${q(projectId)}`);
      setInProgress(r.ok ? r.state : { kind: null });
    } catch {
      setInProgress({ kind: null });
    }
  }, [projectId]);

  const refreshAll = useCallback(() => {
    void refreshStatus();
    void loadGraph();
    void refreshInProgress();
  }, [refreshStatus, loadGraph, refreshInProgress]);

  const selectFile = useCallback(
    async (path: string, staged: boolean, kind: StatusEntryKind) => {
      const seq = ++diffSeq.current;
      setSelected({ path, staged });
      setDiff(null);
      setDiffLoading(true);
      try {
        const d = await api.post<DiffResult>("/api/git/diff", { projectId, path, staged, kind });
        if (diffSeq.current === seq) {
          setDiff(d);
          setDiffLoading(false);
        }
      } catch (e) {
        if (diffSeq.current === seq) {
          setDiff({ ok: false, message: (e as Error).message });
          setDiffLoading(false);
        }
      }
    },
    [projectId],
  );

  const runMutation = useCallback(
    async (url: string, paths: string[]) => {
      try {
        const r = await api.post<GitActionResult>(url, { projectId, paths });
        if (!r.ok) {
          fail(r.message);
          return;
        }
        void refreshStatus();
        void loadGraph();
      } catch (e) {
        fail((e as Error).message);
      }
    },
    [projectId, fail, refreshStatus, loadGraph],
  );
  const stage = useCallback((paths: string[]) => void runMutation("/api/git/stage", paths), [runMutation]);
  const unstage = useCallback(
    (paths: string[]) => void runMutation("/api/git/unstage", paths),
    [runMutation],
  );
  const discard = useCallback(
    async (paths: string[]) => {
      try {
        const r = await api.post<GitActionResult>("/api/git/discard", { projectId, paths });
        if (!r.ok) {
          fail(r.message);
          return;
        }
        // 버린 파일이 현재 diff 선택이면 비운다
        const sel = selectedRef.current;
        if (sel && paths.includes(sel.path)) {
          diffSeq.current++;
          setSelected(null);
          setDiff(null);
        }
        void refreshStatus();
        void loadGraph();
      } catch (e) {
        fail((e as Error).message);
      }
    },
    [projectId, fail, refreshStatus, loadGraph],
  );

  const commit = useCallback(async () => {
    // GitHub Desktop 관례: 요약 줄 + 빈 줄 + 설명 본문
    const message = description.trim()
      ? `${summary.trim()}\n\n${description.trim()}`
      : summary.trim();
    try {
      const r = await api.post<{ ok: true } | { ok: false; message: string }>("/api/git/commit", {
        projectId,
        message,
      });
      if (!r.ok) {
        fail(r.message);
        return;
      }
      setSummary("");
      setDescription("");
      setSelected(null);
      setDiff(null);
      void refreshStatus();
      void loadGraph();
    } catch (e) {
      fail((e as Error).message);
    }
  }, [projectId, summary, description, fail, refreshStatus, loadGraph]);

  const selectCommit = useCallback(
    async (oid: string) => {
      if (selectedOidRef.current === oid) return;
      const seq = ++detailSeq.current;
      setSelectedOid(oid);
      setDetail(null);
      setDetailLoading(true);
      setSelectedFile(null);
      setFileDiff(null);
      try {
        const r = await api.get<CommitDetailResult>(
          `/api/git/commit?projectId=${q(projectId)}&oid=${q(oid)}`,
        );
        if (detailSeq.current !== seq) return;
        setDetail(r.ok ? r.detail : null);
        setDetailLoading(false);
        if (!r.ok) fail(r.message);
      } catch (e) {
        if (detailSeq.current === seq) {
          setDetail(null);
          setDetailLoading(false);
          fail((e as Error).message);
        }
      }
    },
    [projectId, fail],
  );

  const selectCommitFile = useCallback(
    async (file: CommitFileChange) => {
      const d = detailRef.current;
      if (!d) return;
      const seq = ++fileDiffSeq.current;
      setSelectedFile(file.path);
      setFileDiff(null);
      setFileDiffLoading(true);
      try {
        const diffResult = await api.post<DiffResult>("/api/git/commit-diff", {
          projectId,
          oid: d.oid,
          parentOid: d.parents[0] ?? null,
          path: file.path,
        });
        if (fileDiffSeq.current === seq) {
          setFileDiff(diffResult);
          setFileDiffLoading(false);
        }
      } catch (e) {
        if (fileDiffSeq.current === seq) {
          setFileDiff({ ok: false, message: (e as Error).message });
          setFileDiffLoading(false);
        }
      }
    },
    [projectId],
  );

  const runAction = useCallback(
    async (req: ActionReq) => {
      try {
        const r = await api.post<GitActionResult>("/api/git/action", { projectId, ...req });
        if (!r.ok) {
          fail(r.message);
          return;
        }
        // refs 변경: 그래프·상태·진행상태 다시 로드
        void loadGraph();
        void refreshStatus();
        void refreshInProgress();
      } catch (e) {
        fail((e as Error).message);
      }
    },
    [projectId, fail, loadGraph, refreshStatus, refreshInProgress],
  );

  const runRemote = useCallback(
    async (kind: GitOpKind) => {
      if (remoteRunningRef.current) return;
      setRemoteRunning(true);
      try {
        const r = await api.post<GitOpResult>("/api/git/remote", { projectId, kind });
        if (!r.ok && !r.canceled) fail(r.message);
      } catch (e) {
        fail((e as Error).message);
      } finally {
        setRemoteRunning(false);
        refreshAll();
      }
    },
    [projectId, fail, refreshAll],
  );

  const listBranches = useCallback(
    () => api.get<BranchListResult>(`/api/git/branches?projectId=${q(projectId)}`),
    [projectId],
  );

  // 최초 로드(projectId 고정 — key 리마운트라 1회)
  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // 수동 갱신: 창 포커스 / 탭 복귀 시(실시간 watcher 대신)
  useEffect(() => {
    const onFocus = (): void => {
      void refreshStatus();
      void loadGraph();
      void refreshInProgress();
    };
    const onVis = (): void => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshStatus, loadGraph, refreshInProgress]);

  const value: GitContextValue = {
    projectId,
    status,
    statusLoading,
    selected,
    diff,
    diffLoading,
    summary,
    description,
    setSummary,
    setDescription,
    commits,
    layout,
    headOid,
    truncated,
    graphLoading,
    selectedOid,
    detail,
    detailLoading,
    selectedFile,
    fileDiff,
    fileDiffLoading,
    inProgress,
    remoteRunning,
    refreshAll,
    selectFile,
    stage,
    unstage,
    discard,
    commit,
    selectCommit,
    selectCommitFile,
    runAction,
    runRemote,
    listBranches,
  };

  return <GitContext.Provider value={value}>{children}</GitContext.Provider>;
}
