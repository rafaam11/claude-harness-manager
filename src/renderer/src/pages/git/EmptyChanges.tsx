// DT_GitManager에서 흡수 + 단순화. 변경 없음 안내(GitHub 제안 행은 제외).
export default function EmptyChanges({
  onShowHistory,
}: {
  onShowHistory: () => void;
}): React.JSX.Element {
  return (
    <div className="empty-changes">
      <h2 className="empty-title">로컬 변경사항이 없습니다</h2>
      <p className="empty-sub">변경 사항이 없습니다. 커밋 히스토리를 살펴볼 수 있어요.</p>
      <div className="suggestion-list">
        <div className="suggestion-row">
          <span className="suggestion-text">
            <strong>변경 이력 보기</strong>
            <span>커밋 그래프와 히스토리를 살펴봅니다</span>
          </span>
          <button className="btn-secondary" onClick={onShowHistory}>
            History 열기
          </button>
        </div>
      </div>
    </div>
  );
}
