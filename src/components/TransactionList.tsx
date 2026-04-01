import { useEffect, useState } from 'react';
import { CATEGORIES } from '../types';

const API = '/api';

interface Transaction {
  id: number;
  trans_date: string;
  posting_date: string;
  description: string;
  amount: number;
  is_credit: number;
  cardholder: string;
  category: string;
  confirmed: number;
}

interface Props {
  onUpdate: () => void;
  initialCategory?: string;
}

export function TransactionList({ onUpdate, initialCategory = '' }: Props) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filter, setFilter] = useState({ category: initialCategory, cardholder: '', confirmed: '' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCategory, setEditCategory] = useState('');

  const fetchTransactions = async () => {
    const params = new URLSearchParams();
    if (filter.category) params.set('category', filter.category);
    if (filter.cardholder) params.set('cardholder', filter.cardholder);
    if (filter.confirmed) params.set('confirmed', filter.confirmed);
    const res = await fetch(`${API}/transactions?${params}`);
    setTransactions(await res.json());
  };

  useEffect(() => {
    fetchTransactions();
  }, [filter]);

  const updateCategory = async (id: number, description: string) => {
    // Extract a merchant pattern from the description
    const pattern = extractMerchantPattern(description);
    await fetch(`${API}/transactions/${id}/category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: editCategory, merchantPattern: pattern }),
    });
    setEditingId(null);
    fetchTransactions();
    onUpdate();
  };

  const confirmCategory = async (id: number, description: string) => {
    const pattern = extractMerchantPattern(description);
    await fetch(`${API}/transactions/${id}/confirm`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantPattern: pattern }),
    });
    fetchTransactions();
    onUpdate();
  };

  const confirmAll = async () => {
    await fetch(`${API}/transactions/confirm-all`, { method: 'POST' });
    fetchTransactions();
    onUpdate();
  };

  const unconfirmedCount = transactions.filter((t) => !t.confirmed).length;
  const totalAmount = transactions
    .filter((t) => !t.is_credit)
    .reduce((sum, t) => sum + t.amount, 0);
  const creditAmount = transactions
    .filter((t) => t.is_credit)
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
            {transactions.filter((t) => !t.is_credit).length} charges totalling ${totalAmount.toFixed(2)}
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
              <tr key={txn.id} className={txn.is_credit ? 'credit-row' : ''}>
                <td className="date-cell">{txn.trans_date}</td>
                <td className="desc-cell" title={txn.description}>
                  {txn.description}
                </td>
                <td>{txn.cardholder.split(' ')[0]}</td>
                <td className={`amount-cell ${txn.is_credit ? 'credit' : 'debit'}`}>
                  {txn.is_credit ? '-' : ''}${txn.amount.toFixed(2)}
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
  // Try to get a clean merchant name for pattern matching
  let cleaned = description
    .replace(/\s+(ON|BC|AB|QC|MB|SK|NB|NS|PE|NL|NT|YT|NU)\s*$/i, '')
    .replace(/\s+#\d+/g, '')
    .replace(/\s+\d+$/, '')
    .replace(/\*[A-Z0-9]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // For foreign currency transactions, extract merchant after the rate
  const foreignMatch = description.match(/(?:MXN|USD|EUR|GBP)\s+[\d.]+@[\d.]+\s+(.*)/i);
  if (foreignMatch) {
    cleaned = foreignMatch[1].replace(/\s+(ON|BC|AB|QC)\s*$/i, '').replace(/\s+\d+$/, '').trim();
  }

  // Take the first meaningful words (usually the merchant name)
  const words = cleaned.split(/\s+/).slice(0, 3);
  return words.join(' ').toLowerCase();
}
