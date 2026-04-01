import { useEffect, useState } from 'react';
import { collection, getDocs, doc, updateDoc, query, where, addDoc, writeBatch, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { CATEGORIES } from '../types';

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
}

interface StatementInfo {
  id: string;
  statementDate: string;
  periodStart: string;
  periodEnd: string;
}

interface Props {
  onUpdate: () => void;
  initialCategory?: string;
  initialStatement?: string;
  householdId: string;
}

function formatStmtDate(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, m, d] = dateStr.split('-');
  return `${months[parseInt(m) - 1]} ${d}`;
}

export function TransactionList({ onUpdate, initialCategory = '', initialStatement = '', householdId }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState({
    category: initialCategory,
    cardholder: '',
    confirmed: '',
    statement: initialStatement,
  });
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [statements, setStatements] = useState<StatementInfo[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchTransactions(), fetchStatements()]);
      setLoading(false);
    };
    load();
  }, []);

  // Filter client-side to avoid composite index requirements
  useEffect(() => {
    let filtered = allTransactions;
    if (filter.category) filtered = filtered.filter((t) => t.category === filter.category);
    if (filter.cardholder) filtered = filtered.filter((t) => t.cardholder === filter.cardholder);
    if (filter.confirmed === 'true') filtered = filtered.filter((t) => t.confirmed);
    if (filter.confirmed === 'false') filtered = filtered.filter((t) => !t.confirmed);
    if (filter.statement) filtered = filtered.filter((t) => t.statementId === filter.statement);
    setTransactions(filtered);
  }, [allTransactions, filter]);

  const updateCategory = async (id: string, description: string, newCategory: string) => {
    const pattern = extractMerchantPattern(description);
    const txnRef = doc(db, 'households', householdId, 'transactions', id);
    await updateDoc(txnRef, { category: newCategory, confirmed: true });

    if (pattern) {
      await saveMerchantMapping(pattern, newCategory);
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
      await saveMerchantMapping(pattern, txn.category);
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

  const saveMerchantMapping = async (pattern: string, category: string) => {
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


  return (
    <div className="transactions-page">
      <div className="transactions-toolbar">
        <div className="txn-stats">
          <div className="spark-card has-tooltip">
            <div className="spark-card-label">Charges</div>
            <div className="spark-card-value">{transactions.filter((t) => !t.isCredit).length}</div>
            <span className="tooltip">Number of transactions</span>
          </div>
          <div className="spark-card has-tooltip">
            <div className="spark-card-label">Total Spending</div>
            <div className="spark-card-value">{totalAmount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}</div>
            <span className="tooltip">Total spending amount</span>
          </div>
          <div className="spark-card has-tooltip">
            <div className="spark-card-label">Credits</div>
            <div className="spark-card-value" style={{ color: creditAmount > 0 ? 'var(--green)' : undefined }}>
              {creditAmount > 0 ? `-${creditAmount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}` : '$0.00'}
            </div>
            <span className="tooltip">Refunds and credits</span>
          </div>
        </div>
        <div className="filters">
          <select
            className="filter-pill"
            value={filter.statement}
            onChange={(e) => setFilter({ ...filter, statement: e.target.value })}
          >
            <option value="">All Statements</option>
            {statements.map((s) => (
              <option key={s.id} value={s.id}>
                {formatStmtDate(s.statementDate)} ({s.periodStart} to {s.periodEnd})
              </option>
            ))}
          </select>
          <select
            className="filter-pill"
            value={filter.category}
            onChange={(e) => setFilter({ ...filter, category: e.target.value })}
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            className="filter-pill"
            value={filter.cardholder}
            onChange={(e) => setFilter({ ...filter, cardholder: e.target.value })}
          >
            <option value="">All Cardholders</option>
            <option value="Max Blamauer">Max</option>
            <option value="Kathryn Peddar">Kathryn</option>
          </select>
          <select
            className="filter-pill"
            value={filter.confirmed}
            onChange={(e) => setFilter({ ...filter, confirmed: e.target.value })}
          >
            <option value="">All Status</option>
            <option value="false">Unconfirmed</option>
            <option value="true">Confirmed</option>
          </select>
          {unconfirmedCount > 0 && (
            <button className="btn btn-sm" onClick={confirmAll}>
              Confirm All ({unconfirmedCount})
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="table-wrapper">
          <div className="table-skeleton">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <div key={i} className="table-skeleton-row">
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
              <th>Date</th>
              <th>Description</th>
              <th>Cardholder</th>
              <th style={{ textAlign: 'center' }}>Amount</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn) => (
              <tr key={txn.id} className={txn.isCredit ? 'credit-row' : ''}>
                <td className="date-cell">{txn.transDate}</td>
                <td className="desc-cell" title={txn.description}>
                  {txn.description}
                </td>
                <td>{txn.cardholder.split(' ')[0]}</td>
                <td className={`amount-cell ${txn.isCredit ? 'credit' : 'debit'}`}>
                  {txn.isCredit ? '-' : ''}${txn.amount.toFixed(2)}
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
                      {CATEGORIES.map((c) => (
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
                      Auto
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
        <p className="empty-state">No transactions found. Upload a statement to get started.</p>
      )}
    </div>
  );
}

function extractMerchantPattern(description: string): string {
  let cleaned = description
    .replace(/\s+(ON|BC|AB|QC|MB|SK|NB|NS|PE|NL|NT|YT|NU)\s*$/i, '')
    .replace(/\s+#\d+/g, '')
    .replace(/\s+\d+$/, '')
    .replace(/\*[A-Z0-9]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const foreignMatch = description.match(/(?:MXN|USD|EUR|GBP)\s+[\d.]+@[\d.]+\s+(.*)/i);
  if (foreignMatch) {
    cleaned = foreignMatch[1].replace(/\s+(ON|BC|AB|QC)\s*$/i, '').replace(/\s+\d+$/, '').trim();
  }

  const words = cleaned.split(/\s+/).slice(0, 3);
  return words.join(' ').toLowerCase();
}
