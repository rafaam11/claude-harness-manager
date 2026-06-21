// DT_GitManager에서 흡수. merge/rebase/cherry-pick/revert 진행 중 배너 + 계속/중단(useGit).
import type { GraphActionKind } from "@shared/types";
import { useGit } from "./GitContext";

interface BannerButton {
  text: string;
  kind: GraphActionKind;
  danger?: boolean;
}

export default function InProgressBanner(): React.JSX.Element | null {
  const { inProgress: ip, runAction } = useGit();

  if (!ip.kind) return null;

  const act = (kind: GraphActionKind): void => runAction({ kind });

  let label: string;
  let buttons: BannerButton[];
  if (ip.kind === "rebase") {
    const prog = ip.current && ip.total ? ` (${ip.current}/${ip.total})` : "";
    const onto = ip.ontoRef ? ` → ${ip.ontoRef}` : "";
    label = `리베이스 진행 중${prog}${onto}`;
    buttons = [
      { text: "계속", kind: "rebase-continue" },
      { text: "건너뛰기", kind: "rebase-skip" },
      { text: "중단", kind: "rebase-abort", danger: true },
    ];
  } else if (ip.kind === "merge") {
    label = "병합 진행 중 — 충돌을 해결한 뒤 계속하세요";
    buttons = [
      { text: "계속", kind: "merge-continue" },
      { text: "중단", kind: "merge-abort", danger: true },
    ];
  } else if (ip.kind === "cherry-pick") {
    label = "체리픽 진행 중";
    buttons = [
      { text: "계속", kind: "cherry-pick-continue" },
      { text: "건너뛰기", kind: "cherry-pick-skip" },
      { text: "중단", kind: "cherry-pick-abort", danger: true },
    ];
  } else {
    label = "되돌리기(Revert) 진행 중";
    buttons = [
      { text: "계속", kind: "revert-continue" },
      { text: "중단", kind: "revert-abort", danger: true },
    ];
  }

  return (
    <div className="inprogress-banner">
      <span className="inprogress-label">{label}</span>
      <span className="inprogress-actions">
        {buttons.map((b) => (
          <button
            key={b.kind}
            className={b.danger ? "inprogress-btn danger" : "inprogress-btn"}
            onClick={() => act(b.kind)}
          >
            {b.text}
          </button>
        ))}
      </span>
    </div>
  );
}
