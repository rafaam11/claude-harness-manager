import { useEffect, useState } from "react";
import type { UpdaterStatus } from "@shared/types";

/** 사이드바 하단의 버전 배지 + 업데이트 확인 버튼. main의 autoUpdater 상태를 구독해 표시한다. */
export default function UpdateBadge() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdaterStatus>({ state: "idle" });

  useEffect(() => {
    window.updater.getVersion().then(setVersion).catch(() => {});
    const off = window.updater.onStatus(setStatus);
    return off;
  }, []);

  const downloaded = status.state === "downloaded";
  const busy = status.state === "checking" || status.state === "downloading";

  const label = (() => {
    switch (status.state) {
      case "checking":
        return "확인 중…";
      case "available":
        return `새 버전 ${status.version}`;
      case "downloading":
        return `다운로드 ${status.percent}%`;
      case "downloaded":
        return "재시작하여 적용";
      case "error":
        return "확인 실패";
      default:
        return "최신";
    }
  })();

  const onClick = () => {
    if (downloaded) void window.updater.quitAndInstall();
    else void window.updater.check();
  };

  return (
    <div className="update-badge">
      <span className="app-version">{version ? `v${version}` : ""}</span>
      <button
        className="update-btn"
        onClick={onClick}
        disabled={busy}
        title={downloaded ? "앱을 재시작하여 새 버전 적용" : "업데이트 확인"}
      >
        {downloaded ? "재시작하여 적용" : "업데이트 확인"}
      </button>
      <span className={`update-status ${status.state}`}>{label}</span>
    </div>
  );
}
