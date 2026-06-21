// DT_GitManager에서 흡수. Changes / History 좌측 탭.
export default function ModeTabs({
  mode,
  onModeChange,
}: {
  mode: "changes" | "history";
  onModeChange: (mode: "changes" | "history") => void;
}): React.JSX.Element {
  return (
    <div className="left-tabs">
      <button
        className={mode === "changes" ? "left-tab active" : "left-tab"}
        onClick={() => onModeChange("changes")}
      >
        Changes
      </button>
      <button
        className={mode === "history" ? "left-tab active" : "left-tab"}
        onClick={() => onModeChange("history")}
      >
        History
      </button>
    </div>
  );
}
