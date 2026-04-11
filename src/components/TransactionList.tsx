import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, doc, updateDoc, deleteDoc, query, where, addDoc, writeBatch, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { CATEGORIES } from '../types';
import { extractMerchantPattern } from '../lib/categorize';
import { PARENT_CATEGORY_NAMES, transactionMatchesCategoryFilter } from '../lib/categoryGroups';
import { FilterSelect } from './ui/FilterSelect';
import { Modal, ModalBodyPanel } from './ui/Modal';
import { reconcileBillingPeriod } from '../lib/statementPeriod';
import { offsetStatementDropdownLabel } from '../lib/statementMonthOffset';
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
  reimbursed?: boolean;
  partialPayAmount?: number;
  cardProfileId?: string;
}

interface CardProfileInfo { id: string; cardLabel: string; bankName: string; }

interface StatementInfo {
  id: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
  cardProfileId?: string;
  status?: string;
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
  statementMonthOffset: number;
  excludeReimbursed?: boolean;
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

function fmtMoney(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
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
  statementMonthOffset,
  excludeReimbursed,
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
    setStatements(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as StatementInfo))
        .filter((s) => s.periodStart && s.periodEnd)
    );
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
    if (excludeReimbursed) {
      filtered = filtered.filter((t) => !t.reimbursed && !(t.isCredit && t.category !== 'Payment'));
    }
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
  }, [allTransactions, filter, showYearFilter, showCardFilter, excludeReimbursed]);

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

  const [editingPartialPay, setEditingPartialPay] = useState<string | null>(null);
  const [partialPayInput, setPartialPayInput] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const confirmDeleteTransaction = async () => {
    if (!deleteTargetId) return;
    setDeleteBusy(true);
    try {
      await deleteDoc(doc(db, 'households', householdId, 'transactions', deleteTargetId));
      setDeleteTargetId(null);
      fetchTransactions();
      onUpdate();
    } catch (err) {
      console.error('Delete transaction error:', err);
    } finally {
      setDeleteBusy(false);
    }
  };

  const updateStatus = async (id: string, description: string, status: 'confirmed' | 'unconfirmed' | 'reimbursed' | 'partial') => {
    const txnRef = doc(db, 'households', householdId, 'transactions', id);
    if (status === 'partial') {
      const txn = allTransactions.find((t) => t.id === id);
      setEditingPartialPay(id);
      setPartialPayInput(txn?.partialPayAmount?.toString() ?? '');
      return;
    }
    if (status === 'reimbursed') {
      await updateDoc(txnRef, { reimbursed: true, confirmed: true, partialPayAmount: null });
    } else if (status === 'confirmed') {
      await updateDoc(txnRef, { confirmed: true, reimbursed: false, partialPayAmount: null });
      const pattern = extractMerchantPattern(description);
      const txn = allTransactions.find((t) => t.id === id);
      if (pattern && txn) {
        await saveMerchantMapping(pattern, txn.category, txn.cardProfileId);
      }
    } else {
      await updateDoc(txnRef, { confirmed: false, reimbursed: false, partialPayAmount: null });
    }
    fetchTransactions();
    onUpdate();
  };

  const savePartialPay = async (id: string) => {
    const val = parseFloat(partialPayInput);
    const txn = allTransactions.find((t) => t.id === id);
    if (!txn || isNaN(val) || val <= 0 || val >= txn.amount) {
      setEditingPartialPay(null);
      return;
    }
    const txnRef = doc(db, 'households', householdId, 'transactions', id);
    await updateDoc(txnRef, { partialPayAmount: Math.round(val * 100) / 100, confirmed: true, reimbursed: false });
    setEditingPartialPay(null);
    fetchTransactions();
    onUpdate();
  };

  type StatusValue = 'confirmed' | 'unconfirmed' | 'reimbursed' | 'partial';

  const getStatusValue = (txn: Transaction): StatusValue => {
    if (txn.reimbursed) return 'reimbursed';
    if (txn.partialPayAmount != null && txn.partialPayAmount > 0) return 'partial';
    if (txn.confirmed) return 'confirmed';
    return 'unconfirmed';
  };

  const getStatusLabel = (txn: Transaction): string => {
    const status = getStatusValue(txn);
    if (status === 'partial') return `Partial $${txn.partialPayAmount!.toFixed(2)}`;
    if (status === 'reimbursed') return 'Reimbursed';
    if (status === 'confirmed') return 'Confirmed';
    return 'Unconfirmed';
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
    .reduce((sum, t) => {
      if (excludeReimbursed && t.partialPayAmount != null && t.partialPayAmount > 0) return sum + t.partialPayAmount;
      return sum + t.amount;
    }, 0);
  const creditAmount = transactions
    .filter((t) => t.isCredit && t.category !== 'Payment')
    .reduce((sum, t) => sum + t.amount, 0);
  const reimbursedAmount = excludeReimbursed ? 0 : transactions
    .filter((t) => !t.isCredit && (t.reimbursed || (t.partialPayAmount != null && t.partialPayAmount > 0)))
    .reduce((sum, t) => {
      if (t.reimbursed) return sum + t.amount;
      return sum + (t.amount - t.partialPayAmount!);
    }, 0);
  const totalRefunds = creditAmount + reimbursedAmount;

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
    const currentStmt = statements.find((s) => s.id === filter.statement);
    if (!currentStmt) return null;
    // Only compare against statements from the same card
    const sameCardStatements = statements.filter((s) => s.cardProfileId === currentStmt.cardProfileId);
    const sameCardIdx = sameCardStatements.indexOf(currentStmt);
    if (sameCardIdx < 0 || sameCardIdx >= sameCardStatements.length - 1) return null;
    return sameCardStatements[sameCardIdx + 1];
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
                  label: `${offsetStatementDropdownLabel(s.statementDate, r.periodStart, r.periodEnd, statementMonthOffset)}${cardSuffix}`,
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
              ...CATEGORIES.filter((c) => !PARENT_CATEGORY_NAMES.includes(c)).map((c) => ({ value: c, label: c })),
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
        <div className="monthly-summary-compact">
          <div className="monthly-summary-grid monthly-summary-grid--4">
            <div className="monthly-summary-cell">
              <span className="monthly-summary-label">{primaryLabel}</span>
              <span className="monthly-summary-value">{fmtMoney(currentStatementSpending)}</span>
              {totalRefunds > 0 && <span className="monthly-summary-detail" style={{ color: 'var(--green)' }}>Net spend: {fmtMoney(currentStatementSpending - totalRefunds)}</span>}
              {!totalRefunds && primarySubtitle && <span className="monthly-summary-detail">{primarySubtitle}</span>}
            </div>
            <div className="monthly-summary-cell">
              <span className="monthly-summary-label">{previousLabel}</span>
              <span className="monthly-summary-value">{prevStatementSpending !== null ? fmtMoney(prevStatementSpending) : '$0.00'}</span>
              {filter.statement && prevStatementSpending !== null && trendPct !== undefined && (
                <span className="monthly-summary-detail" style={{ color: trendPct <= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {trendPct > 0 ? '+' : ''}{trendPct.toFixed(1)}%
                </span>
              )}
            </div>
            <div className="monthly-summary-cell">
              <span className="monthly-summary-label">Avg charge</span>
              <span className="monthly-summary-value">{chargeCount > 0 ? fmtMoney(avgCharge) : '$0.00'}</span>
              <span className="monthly-summary-detail">{chargeCount > 0 ? `Across ${chargeCount} charge${chargeCount !== 1 ? 's' : ''}` : 'No charges in view'}</span>
            </div>
            <div className="monthly-summary-cell">
              <span className="monthly-summary-label">Refunds & reimbursements</span>
              <span className="monthly-summary-value" style={totalRefunds > 0 ? { color: 'var(--green)' } : undefined}>
                {totalRefunds > 0 ? `-${fmtMoney(totalRefunds)}` : '$0.00'}
              </span>
              {totalRefunds > 0 && reimbursedAmount > 0 && <span className="monthly-summary-detail">{fmtMoney(reimbursedAmount)} reimbursed</span>}
            </div>
          </div>
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
              <th className="txn-delete-col"></th>
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
                <td className={`amount-cell ${txn.isCredit || txn.reimbursed ? 'credit' : 'charge'}`}>
                  {txn.partialPayAmount != null && txn.partialPayAmount > 0 ? (
                    excludeReimbursed ? (
                      formatTxnAmount(txn.partialPayAmount, false)
                    ) : (
                      <span className="partial-pay-amount">
                        <span className="partial-pay-original">{formatTxnAmount(txn.amount, false)}</span>
                        <span className="partial-pay-actual">{formatTxnAmount(txn.partialPayAmount, false)}</span>
                      </span>
                    )
                  ) : (
                    formatTxnAmount(txn.amount, txn.isCredit)
                  )}
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
                  <span className="status-cell-wrapper">
                    <span className={`${getStatusValue(txn)}-badge`}>
                      {getStatusLabel(txn)}
                    </span>
                    <select
                      className="status-overlay-select"
                      value=""
                      onChange={(e) => {
                        const newStatus = e.target.value as StatusValue;
                        if (newStatus) updateStatus(txn.id, txn.description, newStatus);
                      }}
                    >
                      <option value="" disabled>Change status...</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="unconfirmed">Unconfirmed</option>
                      <option value="reimbursed">Reimbursed</option>
                      <option value="partial">Partial pay...</option>
                    </select>
                  </span>
                </td>
                <td className="txn-delete-cell">
                  <button
                    type="button"
                    className="btn-icon-delete"
                    title="Remove transaction"
                    onClick={() => setDeleteTargetId(txn.id)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
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
      {(() => {
        const txn = editingPartialPay ? allTransactions.find((t) => t.id === editingPartialPay) : null;
        return (
          <Modal
            open={!!editingPartialPay}
            onClose={() => setEditingPartialPay(null)}
            title="Partial pay"
            description={txn ? `${txn.description} — ${fmtMoney(txn.amount)}` : ''}
          >
            <ModalBodyPanel>
              <label className="partial-pay-field">
                <span className="partial-pay-field-label">Amount you paid</span>
                <input
                  type="number"
                  className="partial-pay-input"
                  value={partialPayInput}
                  onChange={(e) => setPartialPayInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); savePartialPay(editingPartialPay!); }
                  }}
                  autoFocus
                  min={0}
                  max={txn?.amount}
                  step={0.01}
                  placeholder="0.00"
                />
              </label>
              {txn && partialPayInput && !isNaN(parseFloat(partialPayInput)) && parseFloat(partialPayInput) > 0 && parseFloat(partialPayInput) < txn.amount && (
                <p className="partial-pay-summary">
                  {fmtMoney(txn.amount - parseFloat(partialPayInput))} will count as reimbursed
                </p>
              )}
            </ModalBodyPanel>
            <div className="edit-card-panel-actions">
              <button className="btn" onClick={() => setEditingPartialPay(null)}>Cancel</button>
              <button className="btn btn-save" onClick={() => savePartialPay(editingPartialPay!)}>Save</button>
            </div>
          </Modal>
        );
      })()}
      {(() => {
        const deleteTxn = deleteTargetId ? allTransactions.find((t) => t.id === deleteTargetId) : null;
        return (
          <Modal
            open={deleteTargetId !== null}
            onClose={() => !deleteBusy && setDeleteTargetId(null)}
            title="Remove transaction"
            closeOnBackdropClick={!deleteBusy}
            showCloseButton={!deleteBusy}
          >
            <ModalBodyPanel>
              <p className="modal-confirm-detail">
                {deleteTxn
                  ? `"${deleteTxn.description}" (${formatTxnAmount(deleteTxn.amount, deleteTxn.isCredit)}) will be permanently removed.`
                  : 'This transaction will be permanently removed.'}
              </p>
            </ModalBodyPanel>
            <div className="edit-card-panel-actions">
              <button type="button" className="btn" disabled={deleteBusy} onClick={() => setDeleteTargetId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-destructive"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteTransaction()}
              >
                {deleteBusy ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

