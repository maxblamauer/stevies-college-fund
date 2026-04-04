import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, doc, updateDoc, query, where, addDoc, writeBatch, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { CATEGORIES } from '../types';
import { extractMerchantPattern } from '../lib/categorize';
import { PARENT_CATEGORY_NAMES, transactionMatchesCategoryFilter } from '../lib/categoryGroups';
import { SparkCard } from './ui/SparkCard';
import { FilterSelect } from './ui/FilterSelect';
import { reconcileBillingPeriod } from '../lib/statementPeriod';
import type { StevieMoodReport } from '../lib/stevieMood';

interface Transaction {
  id: string;
  statementId: string;
  transDate: string;
  postingDate: string;
  description: string;
  amount: number;
  isCredit: boolean;
  cardholder: string;
  category: string;
  confirmed: boolean;
  cardProfileId?: string;
}

interface CardProfileInfo { id: string; cardLabel: string; bankName: string; }

interface StatementInfo {
  id: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  cardProfileId?: string;
}

interface Props {
  onUpdate: () => void;
  initialCategory?: string;
  initialStatement?: string;
  initialCardholder?: string;
  initialCard?: string;
  initialYear?: string;
  onYearChange?: (year: string) => void;
  onCardChange?: (card: string) => void;
  householdId: string;
  onStevieMood?: (report: StevieMoodReport | null) => void;
  stevieStatHighlight?: 'good' | 'bad' | null;
}

function formatStmtDate(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, m, d] = dateStr.split('-');
  return `${months[parseInt(m) - 1]} ${d}`;
}

/** YYYY-MM-DD → "Mar 3, 2026" for table / mobile cards */
function formatTxnDisplayDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const y = parseInt(parts[0], 10);
  const mo = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!y || !mo || !d) return isoDate;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[mo - 1]} ${d}, ${y}`;
}

function formatTxnAmount(amount: number, isCredit: boolean): string {
  const formatted = Math.abs(amount).toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isCredit ? `-${formatted}` : formatted;
}

export function TransactionList({
  onUpdate,
  initialCategory = '',
  initialStatement = '',
  initialCardholder = '',
  initialCard = '',
  initialYear = '',
  onYearChange,
  onCardChange,
  householdId,
  onStevieMood,
  stevieStatHighlight = null,
}: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState({
    category: initialCategory,
    cardholder: initialCardholder,
    card: initialCard,
    confirmed: '',
    statement: initialStatement,
    year: initialYear,
  });
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [cardProfiles, setCardProfiles] = useState<CardProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const availableYears = useMemo(
    () =>
      Array.from(
        new Set(
          allTransactions
            .map((t) => t.transDate.slice(0, 4))
            .filter((y) => /^\d{4}$/.test(y))
        )
      )
        .sort()
        .reverse(),
    [allTransactions]
  );
  const showYearFilter = availableYears.length > 1;

  const fetchTransactions = async () => {
    const snap = await getDocs(collection(db, 'households', householdId, 'transactions'));
    const all = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Transaction))
      .sort((a, b) => b.transDate.localeCompare(a.transDate));
    setAllTransactions(all);
  };

  const fetchStatements = async () => {
    const snap = await getDocs(
      query(collection(db, 'households', householdId, 'statements'), orderBy('statementDate', 'desc'))
    );
    setStatements(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StatementInfo)));
  };

  const fetchCardProfiles = async () => {
    const snap = await getDocs(collection(db, 'households', householdId, 'cardProfiles'));
    setCardProfiles(snap.docs.map((d) => ({ id: d.id, ...d.data() } as CardProfileInfo)));
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchTransactions(), fetchStatements(), fetchCardProfiles()]);
      setLoading(false);
    };
    load();
  }, []);

  useEffect(() => {
    if (allTransactions.length === 0) return;
    if (!showYearFilter && filter.year) {
      setFilter((f) => ({ ...f, year: '' }));
      onYearChange?.('');
    }
  }, [allTransactions.length, showYearFilter, filter.year, onYearChange]);

  const showCardFilter = cardProfiles.length > 1;

  // Filter client-side to avoid composite index requirements
  useEffect(() => {
    let filtered = allTransactions;
    if (filter.category) {
      filtered = filtered.filter((t) => transactionMatchesCategoryFilter(t.category, filter.category));
    }
    if (filter.cardholder) filtered = filtered.filter((t) => t.cardholder === filter.cardholder);
    if (filter.card) filtered = filtered.filter((t) => t.cardProfileId === filter.card);
    if (filter.confirmed === 'true') filtered = filtered.filter((t) => t.confirmed);
    if (filter.confirmed === 'false') filtered = filtered.filter((t) => !t.confirmed);
    if (filter.statement) filtered = filtered.filter((t) => t.statementId === filter.statement);
    if (showYearFilter && filter.year) filtered = filtered.filter((t) => t.transDate.startsWith(filter.year));
    setTransactions(filtered);
  }, [allTransactions, filter, showYearFilter, showCardFilter]);

  const updateCategory = async (id: string, description: string, newCategory: string) => {
    const pattern = extractMerchantPattern(description);
    const txnRef = doc(db, 'households', householdId, 'transactions', id);
    const txn = allTransactions.find((t) => t.id === id);
    await updateDoc(txnRef, { category: newCategory, confirmed: true });

    if (pattern) {
      await saveMerchantMapping(pattern, newCategory, txn?.cardProfileId);
      await applyMappingToUnconfirmed(pattern, newCategory);
    }

    fetchTransactions();
    onUpdate();
  };

  const confirmCategory = async (id: string, description: string) => {
    const pattern = extractMerchantPattern(description);
    const txnRef = doc(db, 'households', householdId, 'transactions', id);
    const txn = transactions.find((t) => t.id === id);
    await updateDoc(txnRef, { confirmed: true });

    if (pattern && txn) {
      await saveMerchantMapping(pattern, txn.category, txn.cardProfileId);
    }

    fetchTransactions();
    onUpdate();
  };

  const confirmAll = async () => {
    const q = query(
      collection(db, 'households', householdId, 'transactions'),
      where('confirmed', '==', false)
    );
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.update(d.ref, { confirmed: true }));
    await batch.commit();
    fetchTransactions();
    onUpdate();
  };

  const saveMerchantMapping = async (pattern: string, category: string, cardProfileId?: string) => {
    // Check if mapping already exists
    const q = query(
      collection(db, 'households', householdId, 'categoryMappings'),
      where('merchantPattern', '==', pattern)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      await updateDoc(snap.docs[0].ref, { category });
    } else {
      await addDoc(collection(db, 'households', householdId, 'categoryMappings'), {
        merchantPattern: pattern,
        category,
        ...(cardProfileId ? { cardProfileId } : {}),
      });
    }
  };

  const applyMappingToUnconfirmed = async (pattern: string, category: string) => {
    const q = query(
      collection(db, 'households', householdId, 'transactions'),
      where('confirmed', '==', false)
    );
    const snap = await getDocs(q);
    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      const data = d.data();
      if (data.description.toLowerCase().includes(pattern.toLowerCase())) {
        batch.update(d.ref, { category, confirmed: true });
      }
    });
    await batch.commit();
  };

  const unconfirmedCount = transactions.filter((t) => !t.confirmed).length;
  const totalAmount = transactions
    .filter((t) => !t.isCredit)
    .reduce((sum, t) => sum + t.amount, 0);
  const creditAmount = transactions
    .filter((t) => t.isCredit && t.category !== 'Payment')
    .reduce((sum, t) => sum + t.amount, 0);

  const matchesNonStatementFilters = (t: Transaction) => {
    if (filter.category && !transactionMatchesCategoryFilter(t.category, filter.category)) return false;
    if (filter.cardholder && t.cardholder !== filter.cardholder) return false;
    if (filter.card && t.cardProfileId !== filter.card) return false;
    if (filter.confirmed === 'true' && !t.confirmed) return false;
    if (filter.confirmed === 'false' && t.confirmed) return false;
    return true;
  };

  const currentStatementSpending = filter.statement
    ? allTransactions
        .filter((t) => t.statementId === filter.statement && matchesNonStatementFilters(t) && !t.isCredit)
        .reduce((sum, t) => sum + t.amount, 0)
    : totalAmount;

  const prevStatement = (() => {
    if (!filter.statement || statements.length < 2) return null;
    const currentIdx = statements.findIndex((s) => s.id === filter.statement);
    if (currentIdx < 0 || currentIdx >= statements.length - 1) return null;
    return statements[currentIdx + 1];
  })();

  const prevStatementSpending = (() => {
    if (!prevStatement) return null;
    return allTransactions
      .filter((t) => t.statementId === prevStatement.id && matchesNonStatementFilters(t) && !t.isCredit)
      .reduce((sum, t) => sum + t.amount, 0);
  })();

  const trendDelta = prevStatementSpending !== null ? currentStatementSpending - prevStatementSpending : 0;
  const trendPct = prevStatementSpending !== null && prevStatementSpending > 0
    ? (trendDelta / prevStatementSpending) * 100
    : 0;

  const chargeRows = transactions.filter((t) => !t.isCredit);
  const chargeCount = chargeRows.length;
  const avgCharge = chargeCount > 0 ? totalAmount / chargeCount : 0;

  const hasExtraFilters = Boolean(filter.category || filter.cardholder || filter.card || filter.confirmed);
  const hasAnyFilter = Boolean(filter.statement || hasExtraFilters);

  const primaryLabel = filter.statement
    ? hasExtraFilters
      ? 'In this view'
      : 'Statement charges'
    : hasAnyFilter
      ? 'Filtered charges'
      : 'All charges';

  const primarySubtitleParts: string[] = [];
  if (filter.category) {
    primarySubtitleParts.push(
      PARENT_CATEGORY_NAMES.includes(filter.category) ? `${filter.category} (all)` : filter.category
    );
  }
  if (filter.card) {
    const cp = cardProfiles.find((p) => p.id === filter.card);
    if (cp) primarySubtitleParts.push(cp.cardLabel);
  }
  if (filter.cardholder) primarySubtitleParts.push(filter.cardholder.split(' ')[0] || filter.cardholder);
  if (filter.confirmed === 'true') primarySubtitleParts.push('Confirmed');
  if (filter.confirmed === 'false') primarySubtitleParts.push('Unconfirmed');
  if (!filter.statement) primarySubtitleParts.push('All statements');
  const primarySubtitle =
    primarySubtitleParts.length > 0 ? primarySubtitleParts.join(' · ') : undefined;

  const previousLabel = filter.statement ? 'Previous statement' : 'Period compare';

  useEffect(() => {
    if (!onStevieMood) return;
    if (loading) return;
    if (!filter.statement || prevStatementSpending === null || prevStatementSpending <= 0) {
      onStevieMood(null);
      return;
    }
    const pct = trendPct;
    const good = pct < 0;
    onStevieMood({
      kind: good ? 'good' : 'bad',
      pct,
      detail: `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs prior`,
    });
  }, [onStevieMood, loading, filter.statement, prevStatementSpending, trendPct]);

  return (
    <div className="transactions-page">
      <div
        className={`filters transactions-filters-top${!showYearFilter ? ' transactions-filters-top--no-year' : ''}${showCardFilter ? ' transactions-filters-top--with-card' : ''}`}
      >
        {showCardFilter && (
          <FilterSelect
            value={filter.card}
            onChange={(value) => {
              // Clear statement if it doesn't belong to the new card
              let newStatement = filter.statement;
              if (value && filter.statement) {
                const stmt = statements.find((s) => s.id === filter.statement);
                if (stmt && stmt.cardProfileId !== value) newStatement = '';
              }
              setFilter({ ...filter, card: value, statement: newStatement });
              onCardChange?.(value);
            }}
            options={[
              { value: '', label: 'All Cards' },
              ...cardProfiles.map((p) => ({ value: p.id, label: p.cardLabel })),
            ]}
          />
        )}
        <FilterSelect
          value={filter.statement}
          onChange={(value) => setFilter({ ...filter, statement: value })}
          options={[
            { value: '', label: 'All Statements' },
            ...statements
              .filter((s) => !filter.card || s.cardProfileId === filter.card)
              .map((s) => {
                const r = reconcileBillingPeriod(s.periodStart, s.periodEnd);
                const card = showCardFilter && !filter.card && s.cardProfileId
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
          value={filter.category}
          onChange={(value) => setFilter({ ...filter, category: value })}
          options={[
            { value: '', label: 'All Categories' },
            ...[
              ...PARENT_CATEGORY_NAMES.map((p) => ({ value: p, label: `${p} (all)` })),
              ...CATEGORIES.map((c) => ({ value: c, label: c })),
            ].sort((a, b) => a.label.localeCompare(b.label)),
          ]}
        />
        {showYearFilter && (
          <FilterSelect
            className="filter-pill"
            value={filter.year}
            onChange={(value) => {
              setFilter({ ...filter, year: value });
              onYearChange?.(value);
            }}
            options={[
              { value: '', label: 'All Years' },
              ...availableYears.map((y) => ({ value: y, label: y })),
            ]}
          />
        )}
        <FilterSelect
          value={filter.cardholder}
          onChange={(value) => setFilter({ ...filter, cardholder: value })}
          options={[
            { value: '', label: 'All Cardholders' },
            ...Array.from(new Set(allTransactions.map((t) => t.cardholder).filter(Boolean)))
              .sort((a, b) => a.localeCompare(b))
              .map((name) => ({ value: name, label: name.split(' ')[0] || name })),
          ]}
        />
      </div>
      <div className="transactions-toolbar">
        <div className="stats-summary">
          <SparkCard
            label={primaryLabel}
            value={currentStatementSpending.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}
            subtitle={primarySubtitle}
          />
          <SparkCard
            label={previousLabel}
            value={prevStatementSpending !== null
              ? prevStatementSpending.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
              : '$0.00'}
            change={filter.statement && prevStatementSpending !== null ? trendPct : undefined}
            invertColor
            stevieHighlight={stevieStatHighlight}
          />
          <SparkCard
            label="Avg charge"
            value={
              chargeCount > 0
                ? avgCharge.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 })
                : '$0.00'
            }
            subtitle={chargeCount > 0 ? `Across ${chargeCount} charge${chargeCount !== 1 ? 's' : ''}` : 'No charges in view'}
          />
          <SparkCard
            label="Refunds"
            value={creditAmount > 0 ? `-${creditAmount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}` : '$0.00'}
            valueColor={creditAmount > 0 ? 'var(--green)' : undefined}
            subtitle={filter.category || filter.cardholder || filter.card || filter.confirmed ? 'In filtered rows' : undefined}
          />
        </div>
      </div>

      {!loading && unconfirmedCount > 0 && (
        <div
          className="transactions-pending-bar transactions-pending-bar--above-table"
          role="region"
          aria-label="Unconfirmed transactions"
        >
          <p className="transactions-pending-text">
            <span className="transactions-pending-count">{unconfirmedCount}</span>
            {' '}
            {unconfirmedCount === 1 ? 'row is' : 'rows are'} still unconfirmed.
          </p>
          <button type="button" className="btn btn-sm btn-confirm transactions-confirm-all-btn" onClick={confirmAll}>
            Confirm all
          </button>
        </div>
      )}

      {loading ? (
        <div className="table-wrapper">
          <div className="table-skeleton">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div key={i} className="table-skeleton-row">
                <div className="skeleton-line" style={{ width: '24px', height: '14px' }} />
                <div className="skeleton-line" style={{ width: '80px', height: '14px' }} />
                <div className="skeleton-line" style={{ flex: 1, height: '14px' }} />
                <div className="skeleton-line" style={{ width: '60px', height: '14px' }} />
                <div className="skeleton-line" style={{ width: '60px', height: '14px' }} />
                <div className="skeleton-line" style={{ width: '100px', height: '22px', borderRadius: '12px' }} />
                <div className="skeleton-line" style={{ width: '70px', height: '22px', borderRadius: '12px' }} />
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div className="table-wrapper">
        <table className="transactions-table">
          <thead>
            <tr>
              <th className="txn-index-col">#</th>
              <th>Date</th>
              <th>Description</th>
              <th>Cardholder</th>
              <th style={{ textAlign: 'center' }}>Amount</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn, index) => (
              <tr key={txn.id} className={txn.isCredit ? 'credit-row' : ''}>
                <td className="txn-index-cell">{index + 1}</td>
                <td className="date-cell">{formatTxnDisplayDate(txn.transDate)}</td>
                <td className="desc-cell" title={txn.description}>
                  {txn.description}
                </td>
                <td>{txn.cardholder.split(' ')[0]}</td>
                <td className={`amount-cell ${txn.isCredit ? 'credit' : 'charge'}`}>
                  {formatTxnAmount(txn.amount, txn.isCredit)}
                </td>
                <td>
                  <span className="category-cell-wrapper">
                    <span className={`category-badge clickable-badge cat-${txn.category.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                      {txn.category}
                    </span>
                    <select
                      className="category-overlay-select"
                      value=""
                      onChange={(e) => {
                        const newVal = e.target.value;
                        if (newVal && newVal !== txn.category) {
                          updateCategory(txn.id, txn.description, newVal);
                        }
                      }}
                    >
                      <option value="" disabled>Change category...</option>
                      {[...CATEGORIES].sort((a, b) => a.localeCompare(b)).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </span>
                </td>
                <td>
                  {txn.confirmed ? (
                    <span className="confirmed-badge">Confirmed</span>
                  ) : (
                    <span
                      className="unconfirmed-badge clickable-badge"
                      onClick={() => confirmCategory(txn.id, txn.description)}
                    >
                      Unconfirmed
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {!loading && transactions.length === 0 && (
        <p className="empty-state">
          {allTransactions.length === 0
            ? 'No transactions found. Upload a statement to get started.'
            : 'No transactions match the current filters.'}
        </p>
      )}
    </div>
  );
}

