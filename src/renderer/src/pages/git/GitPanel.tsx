// Git 모드 진입점. projectId → repoPath 해석(/api/git/resolve)을 먼저 수행하고,
// 못 찾으면 폴더 선택으로 board.repoPath를 교정한다. 성공하면 GitProvider로 워크벤치를 감싼다.
import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { RepoResolution } from "@shared/types";
import { GitProvider } from "./GitContext";
import GitWorkbench from "./GitWorkbench";
import Spinner from "./Spinner";

export default function GitPanel({
  projectId,
  onError,
}: {
  projectId: string;
  onError: (message: string) => void;
}): React.JSX.Element {
  // undefined = 확인 중, null = 못 찾음, RepoResolution = 확정
  const [resolution, setResolution] = useState<RepoResolution | null | undefined>(undefined);

  const resolve = useCallback(async () => {
    setResolution(undefined);
    try {
      const r = await api.get<RepoResolution | null>(
        `/api/git/resolve?projectId=${encodeURIComponent(projectId)}`,
      );
      setResolution(r);
    } catch (e) {
      onError((e as Error).message);
      setResolution(null);
    }
  }, [projectId, onError]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  const pickFolder = async (): Promise<void> => {
    try {
      const dir = await window.app.pickDirectory();
      if (!dir) return;
      await api.post(`/api/workspace/board/project/${encodeURIComponent(projectId)}`, {
        repoPath: dir,
      });
      void resolve();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  if (resolution === undefined) {
    return (
      <div className="git-panel git-noresolve">
        <Spinner label="저장소 확인 중..." />
      </div>
    );
  }
  if (resolution === null) {
    return (
      <div className="git-panel git-noresolve">
        <p className="muted">이 프로젝트의 git 저장소를 자동으로 찾지 못했습니다.</p>
        <button className="btn" onClick={pickFolder}>
          저장소 폴더 선택…
        </button>
      </div>
    );
  }
  return (
    <GitProvider projectId={projectId} onError={onError}>
      <GitWorkbench />
    </GitProvider>
  );
}
