// DT_GitManager에서 흡수. 파괴적 git 작업(discard/reset/merge 등) 전 확인 다이얼로그.
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  request,
  onCancel,
}: {
  request: ConfirmRequest;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{request.title}</div>
        <div className="dialog-message">{request.message}</div>
        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onCancel}>
            취소
          </button>
          <button className="dialog-confirm" onClick={request.onConfirm}>
            {request.confirmLabel ?? "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
