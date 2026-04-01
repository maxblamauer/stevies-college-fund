export interface Transaction {
  id: number;
  statement_id: number;
  trans_date: string;
  posting_date: string;
  description: string;
  amount: number;
  is_credit: boolean;
  cardholder: string;
  category: string;
  confirmed: boolean;
}

export interface Statement {
  id: number;
  filename: string;
  statement_date: string;
  period_start: string;
  period_end: string;
  total_balance: number;
  uploaded_at: string;
}

export interface CategoryMapping {
  merchant_pattern: string;
  category: string;
}

export interface MonthlyTotal {
  month: string;
  total: number;
  category?: string;
}

export const CATEGORIES = [
  'Groceries',
  'Restaurants & Dining',
  'Gas & Fuel',
  'Transportation',
  'Shopping - Clothing',
  'Shopping - Online',
  'Shopping - General',
  'Shopping - Home',
  'Entertainment',
  'Subscriptions',
  'Alcohol & Liquor',
  'Health & Pharmacy',
  'Utilities',
  'Travel',
  'Pets',
  'Auto & Maintenance',
  'Convenience Store',
  'Fees & Charges',
  'Payment',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];
