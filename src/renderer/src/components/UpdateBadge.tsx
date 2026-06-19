import { useEffect, useState } from "react";

/** 사이드바 하단의 버전 배지 + "새 버전 확인" 버튼(GitHub 릴리스 페이지를 열어 수동 설치). */
export default function UpdateBadge() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    window.app
      .getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  return (
    <div className="update-badge">
      <span className="app-version">{version ? `v${version}` : ""}</span>
      <button
        className="update-btn"
        onClick={() => void window.app.openReleases()}
        title="GitHub 릴리스에서 최신 버전을 받아 설치"
      >
        새 버전 확인
      </button>
    </div>
  );
}
