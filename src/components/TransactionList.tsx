import { useEffect, useState } from 'react';
import { collection, getDocs, doc, updateDoc, query, where, addDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { CATEGORIES } from '../types';

interface Transaction {
  id: string;
  transDate: string;
  postingDate: string;
  description: string;
  amount: number;
  isCredit: boolean;
  cardholder: string;
  category: string;
  confirmed: boolean;
}

interface Props {
  onUpdate: () => void;
  initialCategory?: string;
  householdId: string;
}

export function TransactionList({ onUpdate, initialCategory = '', householdId }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState({ category: initialCategory, cardholder: '', confirmed: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState('');

  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);

  const fetchTransactions = async () => {
    const snap = await getDocs(collection(db, 'households', householdId, 'transactions'));
    const all = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Transaction))
      .sort((a, b) => b.transDate.localeCompare(a.transDate));
    setAllTransactions(all);
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  // Filter client-side to avoid composite index requirements
  useEffect(() => {
    let filtered = allTransactions;
    if (filter.category) filtered = filtered.filter((t) => t.category === filter.category);
    if (filter.cardholder) filtered = filtered.filter((t) => t.cardholder === filter.cardholder);
    if (filter.confirmed === 'true') filtered = filtered.filter((t) => t.confirmed);
    if (filter.confirmed === 'false') filtered = filtered.filter((t) => !t.confirmed);
    setTransactions(filtered);
  }, [allTransactions, filter]);

  const updateCategory = async (id: string, description: string) => {
    const pattern = extractMerchantPattern(description);
    const txnRef = doc(db, 'households', householdId, 'transactions', id);
    await updateDoc(txnRef, { category: editCategory, confirmed: true });

    // Save the mapping
    if (pattern) {
      await saveMerchantMapping(pattern, editCategory);
      // Update other unconfirmed transactions with same pattern
      await applyMappingToUnconfirmed(pattern, editCategory);
    }

    setEditingId(null);
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
    .filter((t) => t.isCredit)
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="transactions-page">
      {filter.category && (
        <div className="category-filter-banner">
          <button className="btn btn-sm" onClick={() => setFilter({ ...filter, category: '' })}>
            &larr; All Categories
          </button>
          <span className="category-filter-title">{filter.category}</span>
          <span className="category-filter-summary">
            {transactions.filter((t) => !t.isCredit).length} charges totalling ${totalAmount.toFixed(2)}
            {creditAmount > 0 && <> &middot; ${creditAmount.toFixed(2)} in credits</>}
          </span>
        </div>
      )}
      <div className="transactions-header">
        <h2>{filter.category ? '' : 'Transactions'}</h2>
        <div className="filters">
          <select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={filter.cardholder} onChange={(e) => setFilter({ ...filter, cardholder: e.target.value })}>
            <option value="">All Cardholders</option>
            <option value="Max Blamauer">Max</option>
            <option value="Kathryn Peddar">Kathryn</option>
          </select>
          <select value={filter.confirmed} onChange={(e) => setFilter({ ...filter, confirmed: e.target.value })}>
            <option value="">All</option>
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

      <div className="table-wrapper">
        <table className="transactions-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Cardholder</th>
              <th>Amount</th>
              <th>Category</th>
              <th>Status</th>
              <th>Actions</th>
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
                  {editingId === txn.id ? (
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      autoFocus
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`category-badge cat-${txn.category.toLowerCase().replace(/[^a-z]/g, '-')}`}>
                      {txn.category}
                    </span>
                  )}
                </td>
                <td>
                  {txn.confirmed ? (
                    <span className="confirmed-badge">Confirmed</span>
                  ) : (
                    <span className="unconfirmed-badge">Auto</span>
                  )}
                </td>
                <td className="actions-cell">
                  {editingId === txn.id ? (
                    <>
                      <button className="btn btn-xs btn-save" onClick={() => updateCategory(txn.id, txn.description)}>
                        Save
                      </button>
                      <button className="btn btn-xs" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-xs"
                        onClick={() => {
                          setEditingId(txn.id);
                          setEditCategory(txn.category);
                        }}
                      >
                        Edit
                      </button>
                      {!txn.confirmed && (
                        <button className="btn btn-xs btn-confirm" onClick={() => confirmCategory(txn.id, txn.description)}>
                          Confirm
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {transactions.length === 0 && (
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
