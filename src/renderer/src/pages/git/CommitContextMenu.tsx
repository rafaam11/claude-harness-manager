// DT_GitManager에서 흡수. 커밋 우클릭 메뉴(checkout/branch/merge/rebase/cherry-pick/revert/reset/tag).
import { useEffect } from "react";
import type { CommitNode, GraphActionKind } from "@shared/types";
import type { ActionReq } from "./GitContext";

const MENU_W = 220;
const MENU_H = 320;

export interface MenuPosition {
  x: number;
  y: number;
  commit: CommitNode;
}

interface CommitContextMenuProps {
  pos: MenuPosition;
  onClose: () => void;
  /** run a non-destructive action immediately */
  onRun: (req: ActionReq) => void;
  /** run a destructive action after a confirmation dialog */
  onConfirm: (req: ActionReq, title: string, message: string) => void;
  /** prompt for a name, then run a create action */
  onPrompt: (
    kind: "branch-create" | "tag-create",
    title: string,
    placeholder: string,
    oid: string,
  ) => void;
  onCopy: (text: string) => void;
}

export default function CommitContextMenu({
  pos,
  onClose,
  onRun,
  onConfirm,
  onPrompt,
  onCopy,
}: CommitContextMenuProps): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = pos.commit;
  const oid = commit.oid;
  const short = oid.slice(0, 7);
  const branches = commit.refs.filter((r) => r.kind === "branch");
  const tags = commit.refs.filter((r) => r.kind === "tag");

  const style: React.CSSProperties = {
    left: Math.min(pos.x, window.innerWidth - MENU_W),
    top: Math.min(pos.y, window.innerHeight - MENU_H),
  };

  const run = (req: ActionReq): void => {
    onRun(req);
    onClose();
  };
  const confirm = (req: ActionReq, title: string, message: string): void => {
    onConfirm(req, title, message);
    onClose();
  };
  const prompt = (
    kind: "branch-create" | "tag-create",
    title: string,
    placeholder: string,
  ): void => {
    onPrompt(kind, title, placeholder, oid);
    onClose();
  };
  const reset = (
    kind: Extract<GraphActionKind, `reset-${string}`>,
    label: string,
    warn: string,
  ): void => confirm({ kind, oid }, `Reset (${label})`, `현재 브랜치를 ${short}로 이동합니다. ${warn}`);

  return (
    <div
      className="context-menu-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="context-menu" style={style} onClick={(e) => e.stopPropagation()}>
        <button className="context-item" onClick={() => run({ kind: "checkout", oid })}>
          이 커밋 체크아웃
        </button>
        <button
          className="context-item"
          onClick={() => prompt("branch-create", "브랜치 생성", "브랜치 이름")}
        >
          여기에 브랜치 생성…
        </button>
        <button
          className="context-item"
          onClick={() => prompt("tag-create", "태그 생성", "태그 이름")}
        >
          여기에 태그 생성…
        </button>

        <div className="context-separator" />
        <button
          className="context-item"
          onClick={() =>
            confirm({ kind: "cherry-pick", oid }, "체리픽", `${short} 커밋을 현재 브랜치에 적용합니다.`)
          }
        >
          체리픽
        </button>
        <button
          className="context-item"
          onClick={() =>
            confirm({ kind: "revert", oid }, "Revert", `${short} 커밋을 되돌리는 새 커밋을 만듭니다.`)
          }
        >
          되돌리기 (Revert)
        </button>

        <div className="context-separator" />
        <div className="context-section">현재 브랜치 Reset</div>
        <button
          className="context-item"
          onClick={() => reset("reset-soft", "soft", "인덱스와 작업트리는 유지됩니다.")}
        >
          Soft
        </button>
        <button
          className="context-item"
          onClick={() => reset("reset-mixed", "mixed", "인덱스는 초기화되고 작업트리는 유지됩니다.")}
        >
          Mixed
        </button>
        <button
          className="context-item danger"
          onClick={() =>
            reset("reset-hard", "hard", "작업트리 변경이 모두 사라집니다. 되돌릴 수 없습니다.")
          }
        >
          Hard (작업 손실)
        </button>

        {branches.map((b) => (
          <div key={`b-${b.name}`}>
            <div className="context-separator" />
            <div className="context-section">{b.name}</div>
            <button className="context-item" onClick={() => run({ kind: "checkout", ref: b.name })}>
              체크아웃
            </button>
            <button
              className="context-item"
              onClick={() =>
                confirm({ kind: "merge", ref: b.name }, "병합", `현재 브랜치에 ${b.name}을(를) 병합합니다.`)
              }
            >
              병합
            </button>
            <button
              className="context-item"
              onClick={() =>
                confirm(
                  { kind: "rebase", ref: b.name },
                  "Rebase",
                  `현재 브랜치를 ${b.name} 위로 재배치합니다.`,
                )
              }
            >
              여기로 Rebase
            </button>
            <button
              className="context-item danger"
              onClick={() =>
                confirm(
                  { kind: "branch-delete", ref: b.name },
                  "브랜치 삭제",
                  `브랜치 ${b.name}을(를) 삭제합니다.`,
                )
              }
            >
              브랜치 삭제
            </button>
          </div>
        ))}

        {tags.map((t) => (
          <div key={`t-${t.name}`}>
            <div className="context-separator" />
            <div className="context-section">태그 {t.name}</div>
            <button
              className="context-item danger"
              onClick={() =>
                confirm(
                  { kind: "tag-delete", ref: t.name },
                  "태그 삭제",
                  `태그 ${t.name}을(를) 삭제합니다.`,
                )
              }
            >
              태그 삭제
            </button>
          </div>
        ))}

        <div className="context-separator" />
        <button
          className="context-item"
          onClick={() => {
            onCopy(oid);
            onClose();
          }}
        >
          해시 복사
        </button>
      </div>
    </div>
  );
}
