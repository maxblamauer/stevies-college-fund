const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Apply a month offset to an ISO date string and return a display label.
 * E.g. offset -1: "2026-04-03" → "Mar 2026" (the spending month, not the statement month).
 * With offset 0 it returns the original statement date formatted.
 */
export function offsetStatementLabel(statementDate: string, offset: number): string {
  if (offset === 0) {
    const [, m, d] = statementDate.split('-');
    return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${d}`;
  }
  const d = new Date(statementDate + 'T00:00:00');
  d.setMonth(d.getMonth() + offset);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Short axis label with offset applied.
 * offset 0: "Apr 3 '26"
 * offset != 0: "Mar '26"
 */
export function offsetStatementAxisLabel(statementDate: string, offset: number): string {
  if (offset === 0) {
    const [y, m, d] = statementDate.split('-');
    return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${parseInt(d, 10)} '${y.slice(-2)}`;
  }
  const dt = new Date(statementDate + 'T00:00:00');
  dt.setMonth(dt.getMonth() + offset);
  return `${MONTHS_SHORT[dt.getMonth()]} '${String(dt.getFullYear()).slice(-2)}`;
}

/**
 * Full date for tooltips with offset.
 * offset 0: "Apr 3, 2026"
 * offset != 0: "March 2026"
 */
export function offsetStatementFullLabel(statementDate: string, offset: number): string {
  if (offset === 0) {
    const [y, m, d] = statementDate.split('-');
    return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
  }
  const dt = new Date(statementDate + 'T00:00:00');
  dt.setMonth(dt.getMonth() + offset);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[dt.getMonth()]} ${dt.getFullYear()}`;
}

/**
 * Statement dropdown label with offset.
 * offset 0: "Apr 03 (2026-03-04 to 2026-04-03)"
 * offset != 0: "Mar 2026 (2026-03-04 to 2026-04-03)"
 */
export function offsetStatementDropdownLabel(
  statementDate: string,
  periodStart: string,
  periodEnd: string,
  offset: number,
): string {
  const prefix = offsetStatementLabel(statementDate, offset);
  return `${prefix} (${periodStart} to ${periodEnd})`;
}
