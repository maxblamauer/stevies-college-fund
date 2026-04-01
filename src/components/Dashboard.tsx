import { useEffect, useState } from 'react';
import { ResponsivePie } from '@nivo/pie';
import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';
import { collection, getDocs, query, where, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

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
  'Fast Food & Coffee':   '#e0a832',
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

function SparkCard({ label, value, change, subtitle, invertColor }: {
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
  invertColor?: boolean;
}) {
  const changeIsGood = invertColor ? (change ?? 0) < 0 : (change ?? 0) > 0;
  const changeColor = change !== undefined
    ? (changeIsGood ? 'var(--green)' : 'var(--red)')
    : undefined;

  return (
    <div className="spark-card">
      <div className="spark-card-label">{label}</div>
      <div className="spark-card-value">{value}</div>
      {change !== undefined && (
        <div className="spark-card-change" style={{ color: changeColor }}>
          <span className="has-tooltip">
            {change < 0 ? '\u2193' : '\u2191'} {Math.abs(change).toFixed(1)}%
            <span className="tooltip">Compared to previous statement</span>
          </span>
        </div>
      )}
      {subtitle && <div className="spark-card-subtitle">{subtitle}</div>}
    </div>
  );
}

export function Dashboard({ onCategoryClick, theme, householdId }: Props) {
  const [byCategory, setByCategory] = useState<CategoryStat[]>([]);
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [allTransactions, setAllTransactions] = useState<TransactionDoc[]>([]);
  const [cardholder, setCardholder] = useState('');
  const [selectedStatement, setSelectedStatement] = useState('');

  useEffect(() => {
    const load = async () => {
      // Load statements
      const stmtSnap = await getDocs(
        query(collection(db, 'households', householdId, 'statements'), orderBy('statementDate', 'desc'))
      );
      const stmts = stmtSnap.docs.map((d) => ({ id: d.id, ...d.data() } as StatementInfo));
      setStatements(stmts);

      // Load all transactions (debits only for stats)
      const txnSnap = await getDocs(collection(db, 'households', householdId, 'transactions'));
      const txns = txnSnap.docs.map((d) => d.data() as TransactionDoc);
      setAllTransactions(txns);
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
  const avgSpending = stmtTotals.length > 0 ? stmtTotals.reduce((s, t) => s + t.total, 0) / stmtTotals.length : 0;

  // Daily spending for single statement view
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

  const deleteStatement = async (id: string) => {
    if (!confirm('Delete this statement and all its transactions?')) return;
    // Delete transactions for this statement
    const txnSnap = await getDocs(
      query(collection(db, 'households', householdId, 'transactions'), where('statementId', '==', id))
    );
    for (const d of txnSnap.docs) {
      await deleteDoc(d.ref);
    }
    // Delete statement
    await deleteDoc(doc(db, 'households', householdId, 'statements', id));
    window.location.reload();
  };

  const isDark = theme === 'dark';

  const nivoTheme = {
    text: { fill: isDark ? '#c8d0da' : '#475569' },
    tooltip: {
      container: {
        background: isDark ? '#1c2433' : '#ffffff',
        border: `1px solid ${isDark ? '#28334a' : '#d6d3cd'}`,
        borderRadius: '8px',
        color: isDark ? '#c8d0da' : '#2c2c2c',
        fontSize: '13px',
        boxShadow: isDark ? '0 4px 12px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.08)',
      },
    },
    grid: { line: { stroke: isDark ? '#28334a' : '#e5e2dc' } },
    axis: {
      ticks: { text: { fill: isDark ? '#7a8a9e' : '#6b7280', fontSize: 12 } },
      legend: { text: { fill: isDark ? '#7a8a9e' : '#6b7280', fontSize: 12 } },
    },
    labels: { text: { fill: '#ffffff', fontSize: 11, fontWeight: 700 } },
    crosshair: { line: { stroke: isDark ? '#7a8a9e' : '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' } },
  };

  return (
    <div className="dashboard">
      <div className="dashboard-controls">
        <select value={selectedStatement} onChange={(e) => setSelectedStatement(e.target.value)}>
          <option value="">All Statements</option>
          {statements.map((s) => (
            <option key={s.id} value={s.id}>
              {formatStmtDate(s.statementDate)} ({s.periodStart} to {s.periodEnd})
            </option>
          ))}
        </select>
        <select value={cardholder} onChange={(e) => setCardholder(e.target.value)}>
          <option value="">All Cardholders</option>
          <option value="Max Blamauer">Max</option>
          <option value="Kathryn Peddar">Kathryn</option>
        </select>
      </div>

      {byCategory.length === 0 ? (
        <div className="empty-state">
          <p>No data yet. Upload a statement to see your spending dashboard.</p>
        </div>
      ) : (
        <>
          <div className="stats-summary">
            <SparkCard
              label={selectedStatement ? 'Statement Spending' : 'Total Spending'}
              value={fmtMoney(totalSpending)}
              change={!selectedStatement && stmtTotals.length > 1 ? spendingChange : undefined}
              invertColor
            />
            <SparkCard
              label="Latest Statement"
              value={stmtTotals.length > 0 ? fmtMoney(latestTotal) : '--'}
              subtitle={stmtTotals.length > 0 ? stmtTotals[stmtTotals.length - 1].label : undefined}
            />
            <SparkCard
              label="Avg / Statement"
              value={fmtMoney(avgSpending)}
              subtitle={`across ${statements.length} statement${statements.length !== 1 ? 's' : ''}`}
            />
            <SparkCard
              label="Top Category"
              value={byCategory[0]?.category || '--'}
              subtitle={byCategory[0] ? fmtMoney(byCategory[0].total) : undefined}
            />
          </div>

          <div className="charts-grid">
            {!selectedStatement && stmtTotals.length >= 2 && (
              <div className="chart-card">
                <h3>Spending Trend</h3>
                <div style={{ height: 340 }}>
                  <ResponsiveLine
                    data={[{
                      id: 'Spending',
                      data: stmtTotals.map((s) => ({ x: s.label, y: s.total })),
                    }]}
                    margin={{ top: 10, right: 40, bottom: 30, left: 55 }}
                    xScale={{ type: 'point' }}
                    yScale={{ type: 'linear', min: 0, max: 'auto' }}
                    curve="monotoneX"
                    colors={[isDark ? '#8b7fd4' : '#7b6fc4']}
                    lineWidth={2}
                    theme={nivoTheme}
                    axisLeft={{ format: (v) => `$${Number(v).toLocaleString()}`, tickSize: 0, tickPadding: 6, tickValues: 5 }}
                    axisBottom={{ tickSize: 0, tickPadding: 8 }}
                    gridYValues={5}
                    enableGridX={false}
                    enablePoints={true}
                    pointSize={5}
                    pointColor={isDark ? '#8b7fd4' : '#7b6fc4'}
                    pointBorderWidth={0}
                    enableArea={true}
                    areaBaselineValue={0}
                    areaOpacity={0}
                    defs={[{
                      id: 'areaGradient',
                      type: 'linearGradient',
                      colors: [
                        { offset: 0, color: isDark ? '#8b7fd4' : '#7b6fc4', opacity: 0.25 },
                        { offset: 100, color: isDark ? '#8b7fd4' : '#7b6fc4', opacity: 0.0 },
                      ],
                    }]}
                    fill={[{ match: '*', id: 'areaGradient' }]}
                    useMesh={true}
                    tooltip={({ point }) => (
                      <div className="nivo-tip">
                        {point.data.xFormatted}: <strong>{fmtMoney(point.data.y as number)}</strong>
                      </div>
                    )}
                  />
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
                    margin={{ top: 10, right: 10, bottom: 30, left: 55 }}
                    padding={0.35}
                    colors={[isDark ? '#8b7fd4' : '#7b6fc4']}
                    theme={nivoTheme}
                    axisLeft={{ format: (v) => `$${Number(v).toLocaleString()}`, tickSize: 0, tickPadding: 6, tickValues: 5 }}
                    axisBottom={{ tickSize: 0, tickPadding: 6, tickRotation: -45 }}
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
              <div style={{ height: 300 }}>
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
                    if (!id.startsWith('Other')) onCategoryClick(id);
                  }}
                />
              </div>
              <div className="pie-legend">
                {mainSlices.map((s) => (
                  <div
                    key={s.id}
                    className="pie-legend-item"
                    onClick={() => { if (!s.id.startsWith('Other')) onCategoryClick(s.id); }}
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

          <div className="statements-list">
            <h3>Uploaded Statements</h3>
            <table className="statements-table">
              <thead>
                <tr><th>Date</th><th>Period</th><th>Balance</th><th>File</th><th></th></tr>
              </thead>
              <tbody>
                {statements.map((s) => (
                  <tr key={s.id}>
                    <td>{formatStmtDate(s.statementDate)}</td>
                    <td>{s.periodStart} to {s.periodEnd}</td>
                    <td>{fmtMoney(s.totalBalance)}</td>
                    <td>{s.filename}</td>
                    <td><button className="btn btn-xs btn-danger" onClick={() => deleteStatement(s.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
