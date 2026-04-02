interface SparkCardProps {
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
  invertColor?: boolean;
  valueColor?: string;
  changeTooltip?: string;
}

export function SparkCard({
  label,
  value,
  change,
  subtitle,
  invertColor,
  valueColor,
  changeTooltip,
}: SparkCardProps) {
  const changeIsGood = invertColor ? (change ?? 0) < 0 : (change ?? 0) > 0;
  const changeColor = change !== undefined
    ? (changeIsGood ? 'var(--green)' : 'var(--red)')
    : undefined;

  return (
    <div className="spark-card">
      <div className="spark-card-label">{label}</div>
      <div className="spark-card-value" style={valueColor ? { color: valueColor } : undefined}>{value}</div>
      {change !== undefined && (
        <div className="spark-card-change" style={{ color: changeColor }}>
          {changeTooltip ? (
            <span className="has-tooltip">
              {change < 0 ? '\u2193' : '\u2191'} {Math.abs(change).toFixed(1)}%
              <span className="tooltip">{changeTooltip}</span>
            </span>
          ) : (
            <span>
              {change < 0 ? '\u2193' : '\u2191'} {Math.abs(change).toFixed(1)}%
            </span>
          )}
        </div>
      )}
      {subtitle && <div className="spark-card-subtitle">{subtitle}</div>}
    </div>
  );
}
