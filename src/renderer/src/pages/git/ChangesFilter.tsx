// DT_GitManager에서 흡수. 변경 파일 목록 부분 문자열 필터.
import { Search } from "lucide-react";

export default function ChangesFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="changes-filter">
      <Search size={13} />
      <input
        value={value}
        spellCheck={false}
        placeholder="변경 파일 필터..."
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
