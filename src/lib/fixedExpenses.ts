import type { FixedExpense } from '../types';

export interface SyntheticTransaction {
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
  isFixedExpense: true;
  fixedExpenseId: string;
}

/**
 * Generate synthetic transactions from fixed expense definitions for a given date range.
 * For monthly expenses, generates one transaction on the 1st of each month within range.
 */
export function generateFixedExpenseTransactions(
  expenses: FixedExpense[],
  rangeStart: string,
  rangeEnd: string,
): SyntheticTransaction[] {
  const txns: SyntheticTransaction[] = [];
  const start = new Date(rangeStart + 'T00:00:00');
  const end = new Date(rangeEnd + 'T00:00:00');

  for (const expense of expenses) {
    if (!expense.id) continue;
    const expStart = new Date(expense.startDate + 'T00:00:00');
    const expEnd = expense.endDate ? new Date(expense.endDate + 'T00:00:00') : null;

    // Walk month by month from the expense start
    const cursor = new Date(expStart);
    cursor.setDate(1); // normalize to 1st of the month

    while (cursor <= end) {
      if (cursor >= start && cursor >= expStart && (!expEnd || cursor <= expEnd)) {
        const dateStr = cursor.toISOString().slice(0, 10);
        txns.push({
          id: `fixed-${expense.id}-${dateStr}`,
          statementId: `__fixed__`,
          transDate: dateStr,
          postingDate: dateStr,
          description: expense.label,
          amount: expense.amount,
          isCredit: false,
          cardholder: '',
          category: expense.category,
          confirmed: true,
          isFixedExpense: true,
          fixedExpenseId: expense.id,
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  return txns;
}

/**
 * Compute the total monthly fixed expense amount (for active expenses as of today).
 */
export function monthlyFixedTotal(expenses: FixedExpense[]): number {
  const today = new Date().toISOString().slice(0, 10);
  return expenses
    .filter((e) => e.startDate <= today && (!e.endDate || e.endDate >= today))
    .reduce((sum, e) => sum + e.amount, 0);
}
