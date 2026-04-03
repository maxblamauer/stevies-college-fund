import { useEffect, useState } from 'react';
import { ResponsivePie } from '@nivo/pie';
import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { SparkCard } from './ui/SparkCard';
import { FilterSelect } from './ui/FilterSelect';
import { billingPeriodInclusiveDays, reconcileBillingPeriod } from '../lib/statementPeriod';
import type { StevieMoodReport } from '../lib/stevieMood';

const CATEGORY_COLORS: Record<string, string> = {
  'Groceries':            '#4da36a',
  'Restaurants & Dining': '#d48a3a',
  'Shopping - Clothing':  '#9b7ed8',
  'Transportation':       '#d4b43a',
  'Gas & Fuel':           '#4a9ec4',
  'Travel':               '#d46a6a',
  'Shopping - Online':    '#3ab5a5',
  'Utilities':            '#b76ad4',
  'Shopping - General':   '#7a8ee0',
  'Subscriptions':        '#5aa0d4',
  'Health & Pharmacy':    '#d4709a',
  'Alcohol & Liquor':     '#88b44a',
  'Fees & Charges':       '#8899aa',
  'Payment':              '#4abf8a',
  'Convenience Store':    '#cc7a3a',
  'Entertainment':        '#aa80cc',
  'Shopping - Home':      '#c48a5a',
  'Pets':                 '#6bc4a0',
  'Auto & Maintenance':   '#8a9ec2',
  'Other':                '#99a5b0',
};

function getColor(category: string): string {
  return CATEGORY_COLORS[category] || '#99a5b0';
}

interface CategoryStat { category: string; total: number; count: number; }
interface StatementInfo { id: string; statementDate: string; periodStart: string; periodEnd: string; totalBalance: number; filename: string; }
interface TransactionDoc { statementId: string; transDate: string; amount: number; isCredit: boolean; cardholder: string; category: string; }

interface Props {
  onCategoryClick: (category: string) => void;
  theme: 'dark' | 'light';
  householdId: string;
  selectedStatement: string;
  onStatementChange: (id: string) => void;
  cardholder: string;
  onCardholderChange: (cardholder: string) => void;
  onStevieMood?: (report: StevieMoodReport | null) => void;
  stevieStatHighlight?: 'good' | 'bad' | null;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

function formatStmtDate(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, m, d] = dateStr.split('-');
  return `${months[parseInt(m) - 1]} ${d}`;
}

const PIE_THRESHOLD = 3.5;

export function Dashboard({
  onCategoryClick,
  theme,
  householdId,
  selectedStatement,
  onStatementChange,
  cardholder,
  onCardholderChange,
  onStevieMood,
  stevieStatHighlight = null,
}: Props) {
  const [byCategory, setByCategory] = useState<CategoryStat[]>([]);
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [allTransactions, setAllTransactions] = useState<TransactionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendHoverX, setTrendHoverX] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      // Load statements
      const stmtSnap = await getDocs(
        query(collection(db, 'households', householdId, 'statements'), orderBy('statementDate', 'desc'))
      );
      const stmts = stmtSnap.docs.map((d) => ({ id: d.id, ...d.data() } as StatementInfo));
      setStatements(stmts);

      // Load all transactions (charges only — exclude credits/refunds for stats)
      const txnSnap = await getDocs(collection(db, 'households', householdId, 'transactions'));
      const txns = txnSnap.docs.map((d) => d.data() as TransactionDoc);
      setAllTransactions(txns);
      setLoading(false);
    };
    load();
  }, [householdId]);

  // Compute stats from loaded data with filters applied
  const filteredTxns = allTransactions.filter((t) => {
    if (t.isCredit) return false;
    if (cardholder && t.cardholder !== cardholder) return false;
    if (selectedStatement && t.statementId !== selectedStatement) return false;
    return true;
  });

  // Recompute byCategory whenever filters change
  useEffect(() => {
    const catMap = new Map<string, { total: number; count: number }>();
    for (const t of filteredTxns) {
      const existing = catMap.get(t.category) || { total: 0, count: 0 };
      existing.total += t.amount;
      existing.count++;
      catMap.set(t.category, existing);
    }
    const cats = Array.from(catMap.entries())
      .map(([category, { total, count }]) => ({ category, total, count }))
      .sort((a, b) => b.total - a.total);
    setByCategory(cats);
  }, [allTransactions, cardholder, selectedStatement]);

  const totalSpending = byCategory.reduce((sum, c) => sum + c.total, 0);

  // Pie data
  const mainSlices: { id: string; label: string; value: number; color: string }[] = [];
  let otherTotal = 0;
  let otherCount = 0;
  for (const c of byCategory) {
    const pct = (c.total / totalSpending) * 100;
    if (pct >= PIE_THRESHOLD) {
      mainSlices.push({ id: c.category, label: c.category, value: Math.round(c.total * 100) / 100, color: getColor(c.category) });
    } else {
      otherTotal += c.total;
      otherCount++;
    }
  }
  if (otherTotal > 0) {
    const label = `${otherCount} smaller categories`;
    mainSlices.push({ id: '__grouped__', label, value: Math.round(otherTotal * 100) / 100, color: getColor('Other') });
  }

  // Statement totals for line chart
  const sortedStmts = [...statements].sort((a, b) => a.statementDate.localeCompare(b.statementDate));
  const stmtTotals = sortedStmts.map((s) => {
    const total = allTransactions
      .filter((t) => t.statementId === s.id && !t.isCredit && (!cardholder || t.cardholder === cardholder))
      .reduce((sum, t) => sum + t.amount, 0);
    return { id: s.id, label: formatStmtDate(s.statementDate), total: Math.round(total * 100) / 100 };
  });

  const latestTotal = stmtTotals.length > 0 ? stmtTotals[stmtTotals.length - 1].total : 0;
  const prevTotal = stmtTotals.length > 1 ? stmtTotals[stmtTotals.length - 2].total : 0;
  const spendingChange = stmtTotals.length > 1 ? ((latestTotal - prevTotal) / prevTotal) * 100 : 0;
  const selectedStmtIdx = selectedStatement ? stmtTotals.findIndex((s) => s.id === selectedStatement) : -1;
  const selectedStmtTotal = selectedStmtIdx >= 0 ? stmtTotals[selectedStmtIdx].total : 0;
  const selectedPrevTotal = selectedStmtIdx > 0 ? stmtTotals[selectedStmtIdx - 1].total : 0;
  const selectedSpendingChange =
    selectedStmtIdx > 0 && selectedPrevTotal > 0
      ? ((selectedStmtTotal - selectedPrevTotal) / selectedPrevTotal) * 100
      : undefined;
  const avgSpending = stmtTotals.length > 0 ? stmtTotals.reduce((s, t) => s + t.total, 0) / stmtTotals.length : 0;

  const focusIdx = (() => {
    if (stmtTotals.length === 0) return -1;
    if (selectedStatement) {
      const i = stmtTotals.findIndex((s) => s.id === selectedStatement);
      return i >= 0 ? i : stmtTotals.length - 1;
    }
    return stmtTotals.length - 1;
  })();

  const focusTotal = focusIdx >= 0 ? stmtTotals[focusIdx].total : 0;
  const focusStmt = focusIdx >= 0 ? sortedStmts[focusIdx] : null;
  const focusPeriodDays = focusStmt
    ? billingPeriodInclusiveDays(focusStmt.periodStart, focusStmt.periodEnd)
    : 1;

  const stmtsWithPeriod = sortedStmts.filter((s) => s.periodStart && s.periodEnd);
  const allStatementsSpanDays =
    stmtsWithPeriod.length === 0
      ? 1
      : (() => {
          const reconciled = stmtsWithPeriod.map((s) => reconcileBillingPeriod(s.periodStart, s.periodEnd));
          const minStart = reconciled.reduce((min, r) => (r.periodStart < min ? r.periodStart : min), reconciled[0].periodStart);
          const maxEnd = reconciled.reduce((max, r) => (r.periodEnd > max ? r.periodEnd : max), reconciled[0].periodEnd);
          return billingPeriodInclusiveDays(minStart, maxEnd);
        })();

  const dailyAverageInPeriod = selectedStatement
    ? focusIdx >= 0
      ? focusTotal / focusPeriodDays
      : 0
    : sortedStmts.length > 0
      ? totalSpending / allStatementsSpanDays
      : 0;

  const dailySpending = selectedStatement
    ? Object.values(
        filteredTxns
          .filter((t) => t.statementId === selectedStatement)
          .reduce<Record<string, { transDate: string; total: number; count: number }>>((acc, t) => {
            if (!acc[t.transDate]) acc[t.transDate] = { transDate: t.transDate, total: 0, count: 0 };
            acc[t.transDate].total += t.amount;
            acc[t.transDate].count++;
            return acc;
          }, {})
      ).sort((a, b) => a.transDate.localeCompare(b.transDate))
    : [];

  const isDark = theme === 'dark';

  const nivoTheme = {
    text: { fill: isDark ? '#dcdcdc' : '#475569' },
    tooltip: {
      container: {
        background: isDark ? '#2a2a2a' : '#ffffff',
        border: `1px solid ${isDark ? '#3a3a3a' : '#d6d3cd'}`,
        borderRadius: '8px',
        color: isDark ? '#dcdcdc' : '#2c2c2c',
        fontSize: '13px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.08)',
      },
    },
    grid: { line: { stroke: isDark ? '#363636' : '#e5e2dc' } },
    axis: {
      ticks: { text: { fill: isDark ? '#999999' : '#6b7280', fontSize: 11, fontFamily: "'Inter', sans-serif" } },
      legend: { text: { fill: isDark ? '#999999' : '#6b7280', fontSize: 11, fontFamily: "'Inter', sans-serif" } },
    },
    labels: { text: { fill: '#ffffff', fontSize: 11, fontWeight: 700, fontFamily: "'Inter', sans-serif" } },
    crosshair: {
      line: {
        stroke: 'transparent',
        strokeWidth: 0,
      },
    },
  };

  // For bar chart x-axis: show every Nth label if there are too many
  const barTickInterval = dailySpending.length > 15 ? 2 : 1;
  const barTickValues = dailySpending
    .map((d, i) => (i % barTickInterval === 0 ? d.transDate.slice(5) : null))
    .filter(Boolean) as string[];

  useEffect(() => {
    if (!onStevieMood) return;
    if (loading) return;
    if (byCategory.length === 0) {
      onStevieMood(null);
      return;
    }
    if (selectedStatement) {
      if (selectedSpendingChange === undefined) {
        onStevieMood({
          kind: 'neutral',
          detail: 'Pick an older statement to compare.',
        });
        return;
      }
      const pct = selectedSpendingChange;
      const good = pct < 0;
      onStevieMood({
        kind: good ? 'good' : 'bad',
        pct,
        detail: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs prior`,
      });
      return;
    }
    if (stmtTotals.length < 2) {
      onStevieMood(null);
      return;
    }
    const pct = spendingChange;
    const good = pct < 0;
    onStevieMood({
      kind: good ? 'good' : 'bad',
      pct,
      detail: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs last stmt`,
    });
  }, [
    onStevieMood,
    loading,
    byCategory.length,
    selectedStatement,
    selectedSpendingChange,
    spendingChange,
    stmtTotals.length,
  ]);

  return (
    <div className="dashboard">
      <div className="dashboard-top-bar">
        <div className="dashboard-controls">
          <FilterSelect
            value={selectedStatement}
            onChange={onStatementChange}
            options={[
              { value: '', label: 'All Statements' },
              ...statements.map((s) => {
                const r = reconcileBillingPeriod(s.periodStart, s.periodEnd);
                return {
                  value: s.id,
                  label: `${formatStmtDate(s.statementDate)} (${r.periodStart} to ${r.periodEnd})`,
                };
              }),
            ]}
          />
          <FilterSelect
            value={cardholder}
            onChange={onCardholderChange}
            options={[
              { value: '', label: 'All Cardholders' },
              ...Array.from(new Set(allTransactions.map((t) => t.cardholder).filter(Boolean)))
                .sort()
                .map((name) => ({ value: name, label: name.split(' ')[0] || name })),
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="dashboard-skeleton">
          <div className="stats-summary">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="spark-card skeleton-card">
                <div className="skeleton-line skeleton-label" />
                <div className="skeleton-line skeleton-value" />
                <div className="skeleton-line skeleton-sub" />
              </div>
            ))}
          </div>
          <div className="charts-grid">
            <div className="chart-card skeleton-card">
              <div className="skeleton-line skeleton-label" />
              <div className="skeleton-chart" />
            </div>
            <div className="chart-card skeleton-card">
              <div className="skeleton-line skeleton-label" />
              <div className="skeleton-chart" />
            </div>
          </div>
          <div className="category-breakdown skeleton-card">
            <div className="skeleton-line skeleton-label" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton-line skeleton-row" />
            ))}
          </div>
        </div>
      ) : byCategory.length === 0 ? (
        <div className="empty-state">
          <p>No data yet. Upload a statement to see your spending dashboard.</p>
        </div>
      ) : (
        <>
          <div className="stats-summary">
            <SparkCard
              label={selectedStatement ? 'Statement period' : 'Total spending'}
              value={
                selectedStatement
                  ? focusIdx >= 0
                    ? fmtMoney(focusTotal)
                    : '$0.00'
                  : fmtMoney(totalSpending)
              }
              change={selectedStatement ? selectedSpendingChange : (stmtTotals.length > 1 ? spendingChange : undefined)}
              invertColor
              stevieHighlight={stevieStatHighlight}
            />
            <SparkCard
              label="Average"
              value={fmtMoney(avgSpending)}
              subtitle={`across ${statements.length} statement${statements.length !== 1 ? 's' : ''}`}
            />
            <SparkCard
              label="Daily average"
              value={
                sortedStmts.length > 0
                  ? fmtMoney(Math.round(dailyAverageInPeriod * 100) / 100)
                  : '$0.00'
              }
              subtitle={
                selectedStatement && focusStmt
                  ? `${focusPeriodDays} day${focusPeriodDays !== 1 ? 's' : ''} in period`
                  : sortedStmts.length > 0
                    ? `${allStatementsSpanDays} day${allStatementsSpanDays !== 1 ? 's' : ''} across all statements`
                    : undefined
              }
            />
            <SparkCard
              label="Top category"
              value={byCategory[0]?.category || '--'}
              subtitle={byCategory[0] ? fmtMoney(byCategory[0].total) : undefined}
            />
          </div>

          <div className="charts-grid">
            {!selectedStatement && stmtTotals.length < 2 && (
              <div className="chart-card">
                <h3>Spending Trend</h3>
                <div className="chart-placeholder">
                  <p>Upload more statements to see your spending trend over time.</p>
                </div>
              </div>
            )}

            {!selectedStatement && stmtTotals.length >= 2 && (
              <div className="chart-card">
                <h3>Spending Trend</h3>
                <div
                  className="trend-chart-wrap"
                  style={{ height: 340 }}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTrendHoverX(e.clientX - rect.left);
                  }}
                  onMouseLeave={() => setTrendHoverX(null)}
                >
                  <ResponsiveLine
                    data={[{
                      id: 'Spending',
                      data: stmtTotals.map((s) => ({ x: s.label, y: s.total })),
                    }]}
                    margin={{ top: 10, right: 20, bottom: 20, left: 55 }}
                    xScale={{ type: 'point' }}
                    yScale={{ type: 'linear', min: 0, max: 'auto' }}
                    curve="natural"
                    colors={[isDark ? '#8b7fd4' : '#7b6fc4']}
                    lineWidth={2.5}
                    theme={nivoTheme}
                    axisLeft={{ format: (v) => `$${Number(v).toLocaleString()}`, tickSize: 0, tickPadding: 6, tickValues: 5 }}
                    axisBottom={null}
                    gridYValues={5}
                    enableGridX={false}
                    enablePoints={false}
                    enableSlices="x"
                    enableCrosshair={false}
                    enableArea={true}
                    areaBaselineValue={0}
                    areaOpacity={1}
                    defs={[{
                      id: 'areaGradient',
                      type: 'linearGradient',
                      colors: [
                        { offset: 0, color: isDark ? '#8b7fd4' : '#7b6fc4', opacity: 0.3 },
                        { offset: 100, color: isDark ? '#8b7fd4' : '#7b6fc4', opacity: 0.02 },
                      ],
                    }]}
                    fill={[{ match: '*', id: 'areaGradient' }]}
                    useMesh={true}
                    sliceTooltip={({ slice }) => (
                      <div className="nivo-tip">
                        {String(slice.points[0].data.xFormatted)}: <strong>{fmtMoney(Number(slice.points[0].data.y))}</strong>
                      </div>
                    )}
                  />
                  {trendHoverX !== null && (
                    <div className="trend-hover-line" style={{ left: `${trendHoverX}px` }} />
                  )}
                </div>
              </div>
            )}

            {selectedStatement && dailySpending.length > 0 && (
              <div className="chart-card">
                <h3>Daily Spending</h3>
                <div style={{ height: 340 }}>
                  <ResponsiveBar
                    data={dailySpending.map((d) => ({
                      day: d.transDate.slice(5),
                      amount: Math.round(d.total * 100) / 100,
                    }))}
                    keys={['amount']}
                    indexBy="day"
                    margin={{ top: 10, right: 10, bottom: 55, left: 55 }}
                    padding={0.35}
                    colors={[isDark ? '#8b7fd4' : '#7b6fc4']}
                    theme={nivoTheme}
                    axisLeft={{ format: (v) => `$${Number(v).toLocaleString()}`, tickSize: 0, tickPadding: 6, tickValues: 5 }}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 8,
                      tickRotation: -45,
                      tickValues: barTickValues,
                    }}
                    enableGridX={false}
                    gridYValues={5}
                    enableLabel={false}
                    borderRadius={3}
                    tooltip={({ indexValue, value }) => (
                      <div className="nivo-tip">
                        {indexValue}: <strong>{fmtMoney(value as number)}</strong>
                      </div>
                    )}
                  />
                </div>
              </div>
            )}

            <div className="chart-card">
              <h3>{selectedStatement ? 'Category Split' : 'Spending by Category'}</h3>
              <div className="pie-chart-wrap">
                <ResponsivePie
                  data={mainSlices}
                  margin={{ top: 15, right: 15, bottom: 15, left: 15 }}
                  innerRadius={0.5}
                  padAngle={0.8}
                  cornerRadius={3}
                  colors={(d) => d.data.color}
                  borderWidth={0}
                  theme={nivoTheme}
                  enableArcLinkLabels={false}
                  arcLabelsSkipAngle={12}
                  arcLabelsTextColor="#ffffff"
                  arcLabel={(d) => `${((d.arc.endAngle - d.arc.startAngle) / (2 * Math.PI) * 100).toFixed(0)}%`}
                  tooltip={({ datum }) => (
                    <div className="nivo-tip">
                      <span className="nivo-tip-dot" style={{ background: datum.color }} />
                      {datum.label}: <strong>{fmtMoney(datum.value)}</strong>
                      <span className="nivo-tip-pct">
                        ({((datum.value / totalSpending) * 100).toFixed(1)}%)
                      </span>
                    </div>
                  )}
                  onClick={(d) => {
                    const id = d.id as string;
                    if (!id.startsWith('Other') && id !== '__grouped__') onCategoryClick(id);
                  }}
                />
              </div>
              <div className="pie-legend">
                {mainSlices.map((s) => (
                  <div
                    key={s.id}
                    className="pie-legend-item"
                    onClick={() => { if (!s.id.startsWith('Other') && s.id !== '__grouped__') onCategoryClick(s.id); }}
                  >
                    <span className="pie-legend-dot" style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <span className="pie-legend-pct">{((s.value / totalSpending) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="category-breakdown">
            <h3>Category Breakdown</h3>
            <div className="category-bars">
              {byCategory.map((cat) => {
                const color = getColor(cat.category);
                const pct = (cat.total / totalSpending) * 100;
                return (
                  <div key={cat.category} className="category-bar-row clickable" onClick={() => onCategoryClick(cat.category)}>
                    <div className="category-bar-label">
                      <span className="cat-dot" style={{ background: color }} />
                      {cat.category}
                    </div>
                    <div className="category-bar-track">
                      <div className="category-bar-fill" style={{ width: `${(cat.total / byCategory[0].total) * 100}%`, background: color }} />
                    </div>
                    <div className="category-bar-amount">{fmtMoney(cat.total)}</div>
                    <div className="category-bar-pct">{pct.toFixed(1)}%</div>
                    <div className="category-bar-count">{cat.count} txn{cat.count !== 1 ? 's' : ''}</div>
                  </div>
                );
              })}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
