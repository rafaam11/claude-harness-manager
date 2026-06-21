// DT_GitManager에서 흡수. 브랜치/태그 이름 입력 다이얼로그.
import { useState } from "react";

export interface PromptRequest {
  title: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
}

export default function PromptDialog({
  request,
  onCancel,
}: {
  request: PromptRequest;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState("");
  const trimmed = value.trim();

  const submit = (): void => {
    if (trimmed) request.onSubmit(trimmed);
  };

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{request.title}</div>
        <input
          className="dialog-input"
          autoFocus
          value={value}
          placeholder={request.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="dialog-actions">
          <button className="dialog-cancel" onClick={onCancel}>
            취소
          </button>
          <button className="dialog-confirm neutral" onClick={submit} disabled={!trimmed}>
            {request.confirmLabel ?? "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
