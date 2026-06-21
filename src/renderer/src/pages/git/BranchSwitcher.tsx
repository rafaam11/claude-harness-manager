// DT_GitManager에서 흡수 + 단순화. 현재 브랜치 표시 + 전환/생성 드롭다운(useGit).
// GitHub PR 탭은 1차 흡수에서 제외했다(로컬 브랜치만).
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, GitBranch, Plus, Search } from "lucide-react";
import type { BranchInfo } from "@shared/types";
import { useGit, type ActionReq } from "./GitContext";
import PromptDialog, { type PromptRequest } from "./PromptDialog";

export default function BranchSwitcher(): React.JSX.Element {
  const { status, listBranches, runAction } = useGit();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);

  const currentLabel = !status
    ? "..."
    : status.detached
      ? `detached @ ${status.oid?.slice(0, 7) ?? "???"}`
      : (status.branch ?? "(브랜치 없음)");

  // reload the branch list each time the dropdown opens (avoids showing stale refs)
  const openMenu = (): void => {
    setQuery("");
    setError(null);
    setLoading(true);
    setBranches(null);
    setOpen(true);
    void listBranches().then((result) => {
      setLoading(false);
      if (result.ok) setBranches(result.branches);
      else setError(result.message);
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const dispatch = (req: ActionReq): void => {
    setOpen(false);
    runAction(req);
  };

  const pick = (b: BranchInfo): void => {
    if (b.isCurrent) {
      setOpen(false);
      return;
    }
    if (b.kind === "local") {
      dispatch({ kind: "checkout", ref: b.localName });
      return;
    }
    // remote: switch to the same-named local branch if it exists, else create a tracking one
    const localExists = branches?.some((x) => x.kind === "local" && x.localName === b.localName);
    if (localExists) dispatch({ kind: "checkout", ref: b.localName });
    else dispatch({ kind: "checkout-track", ref: b.shortName });
  };

  const newBranch = (): void => {
    setOpen(false);
    setPrompt({
      title: "새 브랜치 만들기",
      placeholder: "브랜치 이름 (현재 HEAD 기준)",
      confirmLabel: "생성",
      onSubmit: (name) => {
        setPrompt(null);
        dispatch({ kind: "branch-create-checkout", name });
      },
    });
  };

  const { locals, remotes, empty } = useMemo(() => {
    const all = branches ?? [];
    const qy = query.trim().toLowerCase();
    const match = (b: BranchInfo): boolean => b.shortName.toLowerCase().includes(qy);
    const localNames = new Set(all.filter((b) => b.kind === "local").map((b) => b.localName));
    const localList = all.filter((b) => b.kind === "local" && match(b));
    // hide a remote branch when a same-named local one already exists
    const remoteList = all.filter(
      (b) => b.kind === "remote" && !localNames.has(b.localName) && match(b),
    );
    return { locals: localList, remotes: remoteList, empty: localList.length === 0 && remoteList.length === 0 };
  }, [branches, query]);

  return (
    <div className="toolbar-segment-wrap">
      <button
        className={open ? "toolbar-segment open" : "toolbar-segment"}
        onClick={openMenu}
        title="브랜치 전환"
      >
        <GitBranch size={16} className="seg-icon" />
        <span className="seg-text">
          <span className="seg-label">현재 브랜치</span>
          <span className="seg-value">{currentLabel}</span>
        </span>
        <ChevronDown size={14} className="seg-chevron" />
      </button>
      {open && (
        <>
          <div className="toolbar-backdrop" onClick={() => setOpen(false)} />
          <div className="toolbar-dropdown branch-dropdown">
            <div className="branch-search">
              <Search size={13} />
              <input
                autoFocus
                value={query}
                spellCheck={false}
                placeholder="브랜치 검색..."
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="branch-list">
              {loading ? (
                <div className="branch-empty">불러오는 중...</div>
              ) : error ? (
                <div className="branch-empty error">{error}</div>
              ) : empty ? (
                <div className="branch-empty">
                  {query ? "일치하는 브랜치가 없습니다" : "브랜치가 없습니다"}
                </div>
              ) : (
                <>
                  {locals.length > 0 && <div className="branch-section-label">로컬</div>}
                  {locals.map((b) => (
                    <button
                      key={b.refName}
                      className={b.isCurrent ? "branch-item current" : "branch-item"}
                      onClick={() => pick(b)}
                    >
                      <span className="branch-check">{b.isCurrent && <Check size={13} />}</span>
                      <span className="branch-item-name">{b.localName}</span>
                    </button>
                  ))}
                  {remotes.length > 0 && <div className="branch-section-label">원격</div>}
                  {remotes.map((b) => (
                    <button key={b.refName} className="branch-item" onClick={() => pick(b)}>
                      <span className="branch-check" />
                      <span className="branch-item-name">{b.shortName}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
            <button className="branch-new" onClick={newBranch}>
              <Plus size={13} />
              새 브랜치 만들기
            </button>
          </div>
        </>
      )}
      {prompt && <PromptDialog request={prompt} onCancel={() => setPrompt(null)} />}
    </div>
  );
}
