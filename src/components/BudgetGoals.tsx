import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { CATEGORIES } from '../types';
import type { BudgetGoal } from '../types';
import { Modal, ModalBodyPanel } from './ui/Modal';

interface Props {
  householdId: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
}

export function BudgetGoals({ householdId }: Props) {
  const [goals, setGoals] = useState<(BudgetGoal & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addCategory, setAddCategory] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [editModalGoalId, setEditModalGoalId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const goalsSnap = await getDocs(collection(db, 'households', householdId, 'budgetGoals'));
    setGoals(
      goalsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as BudgetGoal & { id: string }))
        .sort((a, b) => a.category.localeCompare(b.category))
    );
    setLoading(false);
  }, [householdId]);

  useEffect(() => { loadData(); }, [loadData]);

  const usedCategories = useMemo(() => new Set(goals.map((g) => g.category)), [goals]);
  const availableCategories = useMemo(
    () => CATEGORIES.filter((c) => !usedCategories.has(c) && c !== 'Payment'),
    [usedCategories]
  );

  const handleAdd = async () => {
    if (!addCategory || !addAmount) return;
    const amount = parseFloat(addAmount);
    if (isNaN(amount) || amount <= 0) return;
    await addDoc(collection(db, 'households', householdId, 'budgetGoals'), {
      category: addCategory,
      monthlyAmount: amount,
    });
    setAddCategory('');
    setAddAmount('');
    setAddModalOpen(false);
    await loadData();
  };

  const handleSaveEdit = async () => {
    if (!editModalGoalId) return;
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) return;
    await updateDoc(doc(db, 'households', householdId, 'budgetGoals', editModalGoalId), {
      monthlyAmount: amount,
    });
    setEditModalGoalId(null);
    await loadData();
  };

  const handleDelete = async () => {
    if (!deleteTargetId) return;
    await deleteDoc(doc(db, 'households', householdId, 'budgetGoals', deleteTargetId));
    setDeleteTargetId(null);
    await loadData();
  };

  const editGoal = editModalGoalId ? goals.find((g) => g.id === editModalGoalId) : null;
  const deleteGoal = deleteTargetId ? goals.find((g) => g.id === deleteTargetId) : null;
  const totalBudget = goals.reduce((sum, g) => sum + g.monthlyAmount, 0);

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div className="budget-page">
      <h2>Budget</h2>
      <p className="hint">Set monthly spending limits per category. These appear as markers on the Dashboard breakdown.</p>

      <div className="mappings-card-group">
        {goals.length > 0 ? (
          <>
            <table className="statements-table">
              <thead>
                <tr><th>Category</th><th>Monthly Limit</th><th></th></tr>
              </thead>
              <tbody>
                {goals.map((goal) => (
                  <tr key={goal.id}>
                    <td className="stmt-cell-period">{goal.category}</td>
                    <td className="stmt-cell-balance">{fmtMoney(goal.monthlyAmount)}</td>
                    <td className="mapping-cell-actions">
                      <button
                        className="btn btn-xs"
                        onClick={() => { setEditModalGoalId(goal.id); setEditAmount(String(goal.monthlyAmount)); }}
                      >
                        Edit
                      </button>
                      <button className="btn btn-xs btn-destructive" onClick={() => setDeleteTargetId(goal.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="stmt-cell-period" style={{ fontWeight: 600 }}>Total</td>
                  <td className="stmt-cell-balance" style={{ fontWeight: 600 }}>{fmtMoney(totalBudget)}</td>
                  <td className="mapping-cell-actions">
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => { setAddModalOpen(true); setAddCategory(''); setAddAmount(''); }}
                    >
                      + Budget
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </>
        ) : (
          <div className="budget-empty-body">
            <p className="empty-state">No budget rules set yet.</p>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => { setAddModalOpen(true); setAddCategory(''); setAddAmount(''); }}
            >
              + Budget
            </button>
          </div>
        )}
      </div>

      {/* Add Budget Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add Budget"
        description="Set a monthly spending limit for a category."
      >
        <ModalBodyPanel>
          <div className="edit-card-panel-fields">
            <div className="edit-card-field">
              <label className="edit-card-field-label">Category</label>
              <select
                className="household-input"
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value)}
                style={{ marginBottom: 0 }}
              >
                <option value="">Select category...</option>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="edit-card-field">
              <label className="edit-card-field-label">Monthly Limit</label>
              <input
                type="number"
                className="household-input"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="0.00"
                min="0"
                step="0.01"
                style={{ marginBottom: 0 }}
                autoFocus
              />
            </div>
          </div>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button className="btn" onClick={() => setAddModalOpen(false)}>Cancel</button>
          <button className="btn btn-save" disabled={!addCategory || !addAmount} onClick={handleAdd}>Add</button>
        </div>
      </Modal>

      {/* Edit Budget Modal */}
      <Modal
        open={editModalGoalId !== null}
        onClose={() => setEditModalGoalId(null)}
        title={editGoal ? `Edit ${editGoal.category}` : 'Edit Budget'}
        description="Update the monthly spending limit."
      >
        <ModalBodyPanel>
          <div className="edit-card-panel-fields">
            <div className="edit-card-field">
              <label className="edit-card-field-label">Monthly Limit</label>
              <input
                type="number"
                className="household-input"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                min="0"
                step="0.01"
                style={{ marginBottom: 0 }}
                autoFocus
              />
            </div>
          </div>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button className="btn" onClick={() => setEditModalGoalId(null)}>Cancel</button>
          <button className="btn btn-save" disabled={!editAmount} onClick={handleSaveEdit}>Save</button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        title="Remove Budget"
        description="This action cannot be undone."
      >
        <ModalBodyPanel>
          <p className="modal-confirm-detail">
            Remove the budget for <strong>{deleteGoal?.category}</strong> ({fmtMoney(deleteGoal?.monthlyAmount ?? 0)}/month)?
          </p>
        </ModalBodyPanel>
        <div className="edit-card-panel-actions">
          <button className="btn" onClick={() => setDeleteTargetId(null)}>Cancel</button>
          <button className="btn btn-destructive" onClick={handleDelete}>Remove</button>
        </div>
      </Modal>
    </div>
  );
}
