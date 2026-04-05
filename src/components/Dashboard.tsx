import { useEffect, useState } from 'react';
import { ResponsivePie } from '@nivo/pie';
import { ResponsiveLine } from '@nivo/line';
import { ResponsiveBar } from '@nivo/bar';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { SparkCard } from './ui/SparkCard';
import { FilterSelect } from './ui/FilterSelect';
import { billingPeriodInclusiveDays, reconcileBillingPeriod } from '../lib/statementPeriod';
import { CHILD_TO_PARENT } from '../lib/categoryGroups';
import { generateFixedExpenseTransactions, monthlyFixedTotal } from '../lib/fixedExpenses';
import type { FixedExpense, IncomeSource } from '../types';
import type { StevieMoodReport } from '../lib/stevieMood';

const CATEGORY_COLORS: Record<string, string> = {
  'Groceries':            '#4da36a',
  'Restaurants & Dining': '#d48a3a',
  'Shopping - Clothing':  '#9b7ed8',
  'Rides & Transit':       '#d4b43a',
  'Gas & Fuel':           '#4a9ec4',
  'Travel':               '#d46a6a',
  'Shopping - Online':    '#3ab5a5',
  'Utilities':            '#b76ad4',
  'Shopping - General':   '#7a8ee0',
  'Subscriptions':        '#5aa0d4',
  'Health':               '#d4709a',
  'Alcohol & Liquor':     '#88b44a',
  'Fees & Charges':       '#8899aa',
  'Payment':              '#4abf8a',
  'Convenience Store':    '#cc7a3a',
  'Entertainment':        '#aa80cc',
  'Shopping - Home':      '#c48a5a',
  'Pets':                 '#6bc4a0',
  'Auto & Maintenance':   '#8a9ec2',
  'Other':                '#99a5b0',
  // Parent group colors
  'Shopping':             '#7a8ee0',
  'Transportation':       '#4a9ec4',
  'Food & Dining':        '#d48a3a',
  'Lifestyle':            '#aa80cc',
};

function getColor(category: string): string {
  return CATEGORY_COLORS[category] || '#99a5b0';
}

/* ── Build grouped category rows ── */
interface GroupedCategory {
  name: string;
  total: number;
  count: number;
  color: string;
  isParent: boolean;
  children?: CategoryStat[];
}

function buildGroupedCategories(byCategory: CategoryStat[]): GroupedCategory[] {
  const parentMap = new Map<string, { total: number; count: number; children: CategoryStat[] }>();
  const standalone: GroupedCategory[] = [];

  for (const cat of byCategory) {
    const parent = CHILD_TO_PARENT[cat.category];
    if (parent) {
      if (!parentMap.has(parent)) parentMap.set(parent, { total: 0, count: 0, children: [] });
      const g = parentMap.get(parent)!;
      g.total += cat.total;
      g.count += cat.count;
      g.children.push(cat);
    } else {
      standalone.push({
        name: cat.category,
        total: cat.total,
        count: cat.count,
        color: getColor(cat.category),
        isParent: false,
      });
    }
  }

  // Merge parent groups into result
  for (const [parent, data] of parentMap) {
    // Only create group if there's more than 1 child with data
    if (data.children.length === 1) {
      standalone.push({
        name: data.children[0].category,
        total: data.children[0].total,
        count: data.children[0].count,
        color: getColor(data.children[0].category),
        isParent: false,
      });
    } else {
      data.children.sort((a, b) => b.total - a.total);
      standalone.push({
        name: parent,
        total: data.total,
        count: data.count,
        color: getColor(parent),
        isParent: true,
        children: data.children,
      });
    }
  }

  standalone.sort((a, b) => b.total - a.total);
  return standalone;
}

interface CategoryStat { category: string; total: number; count: number; }
interface StatementInfo { id: string; statementDate: string; periodStart: string; periodEnd: string; totalBalance: number; filename: string; cardProfileId?: string; }
interface TransactionDoc { statementId: string; transDate: string; amount: number; isCredit: boolean; cardholder: string; category: string; cardProfileId?: string; }

interface CardProfileInfo { id: string; cardLabel: string; bankName: string; }

interface Props {
  onCategoryClick: (category: string) => void;
  theme: 'dark' | 'light';
  householdId: string;
  selectedStatement: string;
  onStatementChange: (id: string) => void;
  selectedYear: string;
  onYearChange: (year: string) => void;
  cardholder: string;
  onCardholderChange: (cardholder: string) => void;
  selectedCard: string;
  onCardChange: (card: string) => void;
  onStevieMood?: (report: StevieMoodReport | null) => void;
  stevieStatHighlight?: 'good' | 'bad' | null;
  includeFixedExpenses: boolean;
  onIncludeFixedExpensesChange: (value: boolean) => void;
  blurAmounts: boolean;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function formatStmtDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${d}`;
}

/** Full date for chart tooltips (unique per statement; avoids duplicate x-axis collisions). */
function formatStmtDateFull(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

/** Compact labels for the trend x-axis when space is tight. */
function formatStmtDateAxis(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${MONTHS_SHORT[parseInt(m, 10) - 1]} ${parseInt(d, 10)} '${y.slice(-2)}`;
}

/** Largest N category groups get their own slice; the rest merge into one “smaller categories” wedge (rank-based so several ~1–2% categories still appear). */
const PIE_MAX_INDIVIDUAL_SLICES = 9;

export function Dashboard({
  onCategoryClick,
  theme,
  householdId,
  selectedStatement,
  onStatementChange,
  selectedYear,
  onYearChange,
  cardholder,
  onCardholderChange,
  selectedCard,
  onCardChange,
  onStevieMood,
  stevieStatHighlight = null,
  includeFixedExpenses,
  onIncludeFixedExpensesChange,
  blurAmounts,
}: Props) {
  const [byCategory, setByCategory] = useState<CategoryStat[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [allTransactions, setAllTransactions] = useState<TransactionDoc[]>([]);
  const [cardProfiles, setCardProfiles] = useState<CardProfileInfo[]>([]);
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
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

      // Load all transactions
      const txnSnap = await getDocs(collection(db, 'households', householdId, 'transactions'));
      const txns = txnSnap.docs.map((d) => d.data() as TransactionDoc);
      setAllTransactions(txns);

      // Load card profiles
      const cpSnap = await getDocs(collection(db, 'households', householdId, 'cardProfiles'));
      setCardProfiles(cpSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CardProfileInfo)));

      // Load fixed expenses
      try {
        const feSnap = await getDocs(collection(db, 'households', householdId, 'fixedExpenses'));
        setFixedExpenses(feSnap.docs.map((d) => ({ id: d.id, ...d.data() } as FixedExpense)));
      } catch {
        setFixedExpenses([]);
      }

      // Load income sources
      try {
        const incSnap = await getDocs(collection(db, 'households', householdId, 'incomeSources'));
        setIncomeSources(incSnap.docs.map((d) => ({ id: d.id, ...d.data() } as IncomeSource)));
      } catch {
        setIncomeSources([]);
      }

      setLoading(false);
    };
    load();
  }, [householdId]);

  // Derive available years from transaction dates
  const availableYears = Array.from(
    new Set(allTransactions.map((t) => t.transDate.slice(0, 4)).filter((y) => /^\d{4}$/.test(y)))
  ).sort().reverse();
  const showYearFilter = availableYears.length > 1;

  useEffect(() => {
    if (!showYearFilter && selectedYear) onYearChange('');
  }, [showYearFilter, selectedYear, onYearChange]);

  // Compute stats from loaded data with filters applied
  const showCardFilter = cardProfiles.length > 1;

  const filteredCardTxns = allTransactions.filter((t) => {
    if (t.isCredit) return false;
    if (cardholder && t.cardholder !== cardholder) return false;
    if (selectedCard && t.cardProfileId !== selectedCard) return false;
    if (selectedStatement && t.statementId !== selectedStatement) return false;
    if (showYearFilter && selectedYear && !t.transDate.startsWith(selectedYear)) return false;
    return true;
  });

  // Generate synthetic fixed expense transactions if toggle is on
  const fixedTxns = (() => {
    if (!includeFixedExpenses || fixedExpenses.length === 0) return [];
    if (statements.length === 0) return [];

    let rangeStart: string;
    let rangeEnd: string;

    if (selectedStatement) {
      // Scope to the selected statement's billing period
      const stmt = statements.find((s) => s.id === selectedStatement);
      if (!stmt || !stmt.periodStart || !stmt.periodEnd) return [];
      const r = reconcileBillingPeriod(stmt.periodStart, stmt.periodEnd);
      rangeStart = r.periodStart;
      rangeEnd = r.periodEnd;
    } else {
      // Use full range across all statements
      const allDates = statements.map((s) => s.statementDate).sort();
      const reconciled = statements
        .filter((s) => s.periodStart && s.periodEnd)
        .map((s) => reconcileBillingPeriod(s.periodStart, s.periodEnd));
      rangeStart = reconciled.length > 0
        ? reconciled.reduce((min, r) => r.periodStart < min ? r.periodStart : min, reconciled[0].periodStart)
        : allDates[0];
      rangeEnd = reconciled.length > 0
        ? reconciled.reduce((max, r) => r.periodEnd > max ? r.periodEnd : max, reconciled[0].periodEnd)
        : allDates[allDates.length - 1];
    }

    let synth = generateFixedExpenseTransactions(fixedExpenses, rangeStart, rangeEnd);
    if (showYearFilter && selectedYear) {
      synth = synth.filter((t) => t.transDate.startsWith(selectedYear));
    }
    return synth;
  })();

  const filteredTxns = [...filteredCardTxns, ...fixedTxns];

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
  }, [allTransactions, cardholder, selectedCard, selectedStatement, selectedYear, includeFixedExpenses, fixedExpenses, statements]);

  const totalSpending = byCategory.reduce((sum, c) => sum + c.total, 0);

  // Pie data — use parent-grouped totals; show top spenders as individual slices, merge the tail
  const groupedForPie = buildGroupedCategories(byCategory);
  const sortedPieGroups = [...groupedForPie].sort((a, b) => b.total - a.total);
  const mainSlices: { id: string; label: string; value: number; color: string }[] = [];
  let otherTotal = 0;
  let otherCount = 0;
  for (let i = 0; i < sortedPieGroups.length; i++) {
    const g = sortedPieGroups[i];
    if (i < PIE_MAX_INDIVIDUAL_SLICES) {
      mainSlices.push({
        id: g.name,
        label: g.name,
        value: Math.round(g.total * 100) / 100,
        color: g.color,
      });
    } else {
      otherTotal += g.total;
      otherCount++;
    }
  }
  if (otherTotal > 0) {
    const label = `${otherCount} smaller categor${otherCount === 1 ? 'y' : 'ies'}`;
    mainSlices.push({ id: '__grouped__', label, value: Math.round(otherTotal * 100) / 100, color: getColor('Other') });
  }

  // Statement totals for line chart — only statements that belong to this card (or legacy stmts with
  // matching txns), so the trend / averages / day span don’t mix in other cards’ periods or $0 points.
  const sortedStmts = [...statements].sort((a, b) => a.statementDate.localeCompare(b.statementDate));
  const txnMatchesCardScope = (t: TransactionDoc) => {
    if (t.isCredit) return false;
    if (cardholder && t.cardholder !== cardholder) return false;
    if (selectedCard && t.cardProfileId !== selectedCard) return false;
    if (showYearFilter && selectedYear && !t.transDate.startsWith(selectedYear)) return false;
    return true;
  };
  const chartStmts = selectedCard
    ? sortedStmts.filter((s) => {
        if (s.cardProfileId === selectedCard) return true;
        if (s.cardProfileId) return false;
        return allTransactions.some((t) => t.statementId === s.id && txnMatchesCardScope(t));
      })
    : sortedStmts;

  const stmtTotals = chartStmts.map((s) => {
    const total = allTransactions
      .filter((t) => t.statementId === s.id && txnMatchesCardScope(t))
      .reduce((sum, t) => sum + t.amount, 0);
    return {
      id: s.id,
      label: formatStmtDate(s.statementDate),
      statementDate: s.statementDate,
      total: Math.round(total * 100) / 100,
    };
  });

  const trendChartTickDates =
    stmtTotals.length <= 7
      ? stmtTotals.map((s) => s.statementDate)
      : (() => {
          const n = stmtTotals.length;
          const maxTicks = 7;
          const step = Math.max(1, Math.ceil((n - 1) / (maxTicks - 1)));
          const idxs = new Set<number>([0, n - 1]);
          for (let i = step; i < n - 1; i += step) idxs.add(i);
          return [...idxs].sort((a, b) => a - b).map((i) => stmtTotals[i].statementDate);
        })();

  const latestTotal = stmtTotals.length > 0 ? stmtTotals[stmtTotals.length - 1].total : 0;
  const prevTotal = stmtTotals.length > 1 ? stmtTotals[stmtTotals.length - 2].total : 0;
  const spendingChange =
    stmtTotals.length > 1 && prevTotal > 0
      ? ((latestTotal - prevTotal) / prevTotal) * 100
      : undefined;
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
  const focusStmt = focusIdx >= 0 ? chartStmts[focusIdx] : null;
  const focusPeriodDays = focusStmt
    ? billingPeriodInclusiveDays(focusStmt.periodStart, focusStmt.periodEnd)
    : 1;

  const stmtsWithPeriod = chartStmts.filter((s) => s.periodStart && s.periodEnd);
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
    : chartStmts.length > 0
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
    if (spendingChange === undefined || !Number.isFinite(spendingChange)) {
      onStevieMood({
        kind: 'neutral',
        detail: 'Prior statement had no spending in this view to compare.',
      });
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
        <div className="filters dashboard-filters">
          {showCardFilter && (
            <FilterSelect
              value={selectedCard}
              onChange={(value) => {
                onCardChange(value);
                if (value && selectedStatement) {
                  const stmt = statements.find((s) => s.id === selectedStatement);
                  if (stmt && stmt.cardProfileId !== value) onStatementChange('');
                }
              }}
              options={[
                { value: '', label: 'All Cards' },
                ...cardProfiles.map((p) => ({ value: p.id, label: p.cardLabel })),
              ]}
            />
          )}
          <FilterSelect
            value={selectedStatement}
            onChange={onStatementChange}
            options={[
              { value: '', label: 'All Statements' },
              ...statements
                .filter((s) => !selectedCard || s.cardProfileId === selectedCard)
                .map((s) => {
                  const r = reconcileBillingPeriod(s.periodStart, s.periodEnd);
                  const card = showCardFilter && !selectedCard && s.cardProfileId
                    ? cardProfiles.find((p) => p.id === s.cardProfileId)
                    : null;
                  const cardSuffix = card ? ` · ${card.cardLabel}` : '';
                  return {
                    value: s.id,
                    label: `${formatStmtDate(s.statementDate)} (${r.periodStart} to ${r.periodEnd})${cardSuffix}`,
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
                .sort((a, b) => a.localeCompare(b))
                .map((name) => ({ value: name, label: name.split(' ')[0] || name })),
            ]}
          />
          {showYearFilter && (
            <FilterSelect
              value={selectedYear}
              onChange={onYearChange}
              options={[
                { value: '', label: 'All Years' },
                ...availableYears.map((y) => ({ value: y, label: y })),
              ]}
            />
          )}
          {fixedExpenses.length > 0 && (
            <label className="fixed-expense-toggle">
              <input
                type="checkbox"
                checked={includeFixedExpenses}
                onChange={(e) => onIncludeFixedExpensesChange(e.target.checked)}
              />
              <span className="fixed-expense-toggle-track" />
              <span className="fixed-expense-toggle-label">Fixed expenses</span>
            </label>
          )}
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
          <div className={`stats-summary${includeFixedExpenses && fixedExpenses.length > 0 && incomeSources.length > 0 ? ' stats-summary--8' : ''}${blurAmounts ? ' blur-amounts' : ''}`}>
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
              subtitle={`across ${chartStmts.length} statement${chartStmts.length !== 1 ? 's' : ''}`}
            />
            <SparkCard
              label="Daily average"
              value={
                chartStmts.length > 0
                  ? fmtMoney(Math.round(dailyAverageInPeriod * 100) / 100)
                  : '$0.00'
              }
              subtitle={
                selectedStatement && focusStmt
                  ? `${focusPeriodDays} day${focusPeriodDays !== 1 ? 's' : ''} in period`
                  : chartStmts.length > 0
                    ? `${allStatementsSpanDays} day${allStatementsSpanDays !== 1 ? 's' : ''} across all statements`
                    : undefined
              }
            />
            <SparkCard
              label="Top category"
              value={groupedForPie.length > 0 ? groupedForPie[0].name : '--'}
              subtitle={groupedForPie.length > 0 ? fmtMoney(groupedForPie[0].total) : undefined}
            />
            {includeFixedExpenses && fixedExpenses.length > 0 && (() => {
              const fixedMonthly = monthlyFixedTotal(fixedExpenses);
              const cardPortion = selectedStatement
                ? focusIdx >= 0 ? focusTotal : 0
                : latestTotal;
              const totalMonthly = cardPortion + fixedMonthly;
              const totalIncome = incomeSources.reduce((sum, s) => sum + s.amount, 0);
              const surplus = totalIncome - totalMonthly;

              return (
                <>
                  <SparkCard
                    label="Fixed monthly expenses"
                    value={fmtMoney(fixedMonthly)}
                    subtitle={`${fixedExpenses.filter((e) => !e.endDate || e.endDate >= new Date().toISOString().slice(0, 10)).length} recurring`}
                  />
                  <SparkCard
                    label="Total monthly spending"
                    value={fmtMoney(totalMonthly)}
                    subtitle="Cards + fixed expenses"
                  />
                  {incomeSources.length > 0 && (
                    <SparkCard
                      label="Monthly income"
                      value={fmtMoney(totalIncome)}
                      subtitle={incomeSources.map((s) => s.person).join(' + ')}
                    />
                  )}
                  {incomeSources.length > 0 && (
                    <SparkCard
                      label="Monthly surplus"
                      value={fmtMoney(Math.abs(surplus))}
                      valueColor={surplus >= 0 ? 'var(--green)' : 'var(--red)'}
                      subtitle={surplus >= 0 ? 'Left over after spending' : 'Over budget'}
                    />
                  )}
                </>
              );
            })()}
          </div>

          <div className="charts-grid">
            {!selectedStatement && showCardFilter && !selectedCard && (() => {
              const cardSpending = cardProfiles.map((p) => {
                const total = filteredCardTxns
                  .filter((t) => t.cardProfileId === p.id)
                  .reduce((sum, t) => sum + t.amount, 0);
                return { card: p.cardLabel, amount: Math.round(total * 100) / 100 };
              }).filter((d) => d.amount > 0);

              if (includeFixedExpenses && fixedTxns.length > 0) {
                const fixedTotal = fixedTxns.reduce((sum, t) => sum + t.amount, 0);
                cardSpending.push({ card: 'Fixed Expenses', amount: Math.round(fixedTotal * 100) / 100 });
              }

              if (cardSpending.length === 0) return (
                <div className="chart-card">
                  <h3>Spending by Card</h3>
                  <div className="chart-placeholder">
                    <p>No spending data yet.</p>
                  </div>
                </div>
              );

              return (
                <div className="chart-card">
                  <h3>Spending by Card</h3>
                  <div style={{ height: 340 }}>
                    <ResponsiveBar
                      data={cardSpending}
                      keys={['amount']}
                      indexBy="card"
                      margin={{ top: 10, right: 10, bottom: 55, left: 65 }}
                      padding={0.4}
                      colors={[isDark ? '#8b7fd4' : '#7b6fc4']}
                      theme={nivoTheme}
                      axisLeft={{ format: (v) => `$${Number(v).toLocaleString()}`, tickSize: 0, tickPadding: 8, tickValues: 5 }}
                      axisBottom={{ tickSize: 0, tickPadding: 12 }}
                      enableGridX={false}
                      gridYValues={5}
                      enableLabel={false}
                      borderRadius={4}
                      tooltip={({ indexValue, value }) => (
                        <div className="nivo-tip">
                          {indexValue}: <strong>{fmtMoney(value as number)}</strong>
                        </div>
                      )}
                    />
                  </div>
                </div>
              );
            })()}

            {!selectedStatement && (!showCardFilter || selectedCard) && stmtTotals.length < 2 && (
              <div className="chart-card">
                <h3>Spending Trend</h3>
                <div className="chart-placeholder">
                  <p>Upload more statements to see your spending trend over time.</p>
                </div>
              </div>
            )}

            {!selectedStatement && (!showCardFilter || selectedCard) && stmtTotals.length >= 2 && (
              <div className="chart-card chart-card--overflow-visible">
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
                      data: stmtTotals.map((s) => ({ x: s.statementDate, y: s.total })),
                    }]}
                    margin={{ top: 10, right: 28, bottom: 72, left: 58 }}
                    xScale={{ type: 'point' }}
                    yScale={{ type: 'linear', min: 0, max: 'auto' }}
                    curve="monotoneX"
                    colors={[isDark ? '#8b7fd4' : '#7b6fc4']}
                    lineWidth={2.5}
                    theme={nivoTheme}
                    axisLeft={{
                      format: (v) => `$${Number(v).toLocaleString()}`,
                      tickSize: 0,
                      tickPadding: 8,
                      tickValues: 5,
                    }}
                    axisBottom={{
                      tickSize: 0,
                      tickPadding: 14,
                      tickRotation: -32,
                      tickValues: trendChartTickDates,
                      format: (v) => formatStmtDateAxis(String(v)),
                    }}
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
                    sliceTooltip={({ slice }) => {
                      const xRaw = slice.points[0].data.x;
                      const iso = typeof xRaw === 'string' ? xRaw : String(xRaw);
                      return (
                        <div className="nivo-tip">
                          {formatStmtDateFull(iso)}: <strong>{fmtMoney(Number(slice.points[0].data.y))}</strong>
                        </div>
                      );
                    }}
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
                  arcLabelsSkipAngle={18}
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
              {(() => {
                const grouped = buildGroupedCategories(byCategory);
                const maxTotal = grouped.length > 0 ? grouped[0].total : 1;
                return grouped.map((group) => {
                  const pct = (group.total / totalSpending) * 100;
                  const isExpanded = expandedGroups.has(group.name);

                  if (!group.isParent) {
                    return (
                      <div key={group.name} className="category-bar-row clickable" onClick={() => onCategoryClick(group.name)}>
                        <div className="category-bar-label">
                          <span className="cat-dot" style={{ background: group.color }} />
                          {group.name}
                        </div>
                        <div className="category-bar-track">
                          <div className="category-bar-fill" style={{ width: `${(group.total / maxTotal) * 100}%`, background: group.color }} />
                        </div>
                        <div className="category-bar-amount">{fmtMoney(group.total)}</div>
                        <div className="category-bar-pct">{pct.toFixed(1)}%</div>
                        <div className="category-bar-count">{group.count} txn{group.count !== 1 ? 's' : ''}</div>
                      </div>
                    );
                  }

                  return (
                    <div key={group.name} className="category-group">
                      <div
                        className="category-bar-row clickable category-parent-row"
                        onClick={() => {
                          setExpandedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(group.name)) next.delete(group.name);
                            else next.add(group.name);
                            return next;
                          });
                        }}
                      >
                        <div className="category-bar-label">
                          <span className="cat-dot" style={{ background: group.color }} />
                          {group.name}
                          <span className="cat-sub-count">({group.children!.length})</span>
                        </div>
                        <div className="category-bar-track">
                          <div className="category-bar-fill" style={{ width: `${(group.total / maxTotal) * 100}%`, background: group.color }} />
                        </div>
                        <div className="category-bar-amount">{fmtMoney(group.total)}</div>
                        <div className="category-bar-pct">{pct.toFixed(1)}%</div>
                        <div className="category-bar-count">{group.count} txn{group.count !== 1 ? 's' : ''}</div>
                      </div>
                      {isExpanded && group.children && (
                        <div className="category-children">
                          {group.children.map((child) => {
                            const childPct = (child.total / totalSpending) * 100;
                            const childColor = getColor(child.category);
                            return (
                              <div
                                key={child.category}
                                className="category-bar-row clickable category-child-row"
                                onClick={() => onCategoryClick(child.category)}
                              >
                                <div className="category-bar-label">
                                  <span className="cat-dot" style={{ background: childColor }} />
                                  {child.category}
                                </div>
                                <div className="category-bar-track">
                                  <div className="category-bar-fill" style={{ width: `${(child.total / maxTotal) * 100}%`, background: childColor }} />
                                </div>
                                <div className="category-bar-amount">{fmtMoney(child.total)}</div>
                                <div className="category-bar-pct">{childPct.toFixed(1)}%</div>
                                <div className="category-bar-count">{child.count} txn{child.count !== 1 ? 's' : ''}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
