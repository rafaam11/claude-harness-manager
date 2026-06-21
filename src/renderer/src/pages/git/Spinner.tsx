// DT_GitManager에서 흡수.
interface SpinnerProps {
  size?: number;
  label?: string;
}

export default function Spinner({ size = 16, label }: SpinnerProps): React.JSX.Element {
  return (
    <span className="spinner-wrap">
      <span className="spinner" style={{ width: size, height: size }} />
      {label && <span className="spinner-label">{label}</span>}
    </span>
  );
}
