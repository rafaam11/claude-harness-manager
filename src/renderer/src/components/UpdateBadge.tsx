import { useEffect, useState } from "react";
import type { UpdaterStatus } from "@shared/types";

/**
 * 사이드바 하단의 버전 배지 + 업데이트 버튼. main의 electron-updater 상태를 구독해 표시한다.
 * 새 버전은 배경에서 차등 다운로드되고, 완료되면 버튼이 "재시작하여 적용"으로 바뀐다.
 */
export default function UpdateBadge() {
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<UpdaterStatus>({ state: "idle" });

  useEffect(() => {
    window.app
      .getVersion()
      .then(setVersion)
      .catch(() => {});
    return window.app.onUpdaterStatus(setStatus);
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

  const onClick = (): void => {
    if (downloaded) void window.app.quitAndInstall();
    else void window.app.checkForUpdates();
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
      {status.state === "error" && (
        <button
          className="update-link"
          onClick={() => void window.app.openReleases()}
          title="GitHub 릴리스에서 최신 버전을 직접 받아 설치"
        >
          릴리스 페이지 열기
        </button>
      )}
    </div>
  );
}
