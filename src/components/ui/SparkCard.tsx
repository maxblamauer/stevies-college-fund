interface SparkCardProps {
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
  invertColor?: boolean;
  valueColor?: string;
  changeTooltip?: string;
  /** Tooltip shown on hover over the card */
  tooltip?: string;
  /** Mood-coloured ring while Stevie's note is open (green = happy/good context, red = worried) */
  stevieHighlight?: 'good' | 'bad' | null;
}

export function SparkCard({
  label,
  value,
  change,
  subtitle,
  invertColor,
  valueColor,
  changeTooltip,
  tooltip,
  stevieHighlight = null,
}: SparkCardProps) {
  const changeIsGood = invertColor ? (change ?? 0) < 0 : (change ?? 0) > 0;
  const changeColor = change !== undefined
    ? (changeIsGood ? 'var(--green)' : 'var(--red)')
    : undefined;

  const pctLabel =
    change !== undefined
      ? changeIsGood
        ? `${Math.abs(change).toFixed(1)}%`
        : `-${Math.abs(change).toFixed(1)}%`
      : '';

  const pctInner =
    change !== undefined ? (
      changeTooltip ? (
        <span className="has-tooltip">
          <span>{pctLabel}</span>
          <span className="tooltip">{changeTooltip}</span>
        </span>
      ) : (
        <span>{pctLabel}</span>
      )
    ) : null;

  const stevieToneClass =
    stevieHighlight === 'good'
      ? ' spark-card--stevie-highlight--good'
      : stevieHighlight === 'bad'
        ? ' spark-card--stevie-highlight--bad'
        : '';

  return (
    <div className={`spark-card${stevieToneClass}${tooltip ? ' has-tooltip' : ''}`}>
      <div className="spark-card-label">{label}</div>
      {tooltip && <span className="tooltip spark-card-tooltip">{tooltip}</span>}
      <div className="spark-card-body spark-card-body--plain">
        <div className="spark-card-value" style={valueColor ? { color: valueColor } : undefined}>
          {value}
        </div>
        {change !== undefined && (
          <div className="spark-card-change-pct" style={{ color: changeColor }}>
            {pctInner}
          </div>
        )}
        {subtitle && <div className="spark-card-subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}
