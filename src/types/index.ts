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

export interface CardProfile {
  id?: string;
  cardLabel: string;            // user-friendly name, e.g. "BMO Mastercard"
  bankName: string;             // detected bank name
  cardholders: string[];        // display names, e.g. ["Max Blamauer", "Kathryn Peddar"]
  cardholderPatterns: string[]; // patterns to match in PDF, e.g. ["MR MAX BLAMAUER", "MRS KATHRYN PEDDAR"]
  hasSections: boolean;         // true if statement splits transactions by cardholder
  useTwoDateFormat: boolean;    // true if transactions have trans date + posting date
  creditIndicator: string;      // "CR", "-", etc.
}

export interface FixedExpense {
  id?: string;
  label: string;
  amount: number;
  category: string;
  frequency: 'monthly';
  startDate: string;   // YYYY-MM-DD
  endDate?: string;     // YYYY-MM-DD, optional — ongoing if not set
}

export interface IncomeSource {
  id?: string;
  person: string;
  amount: number;        // monthly amount
}

export const CATEGORIES = [
  'Groceries',
  'Restaurants & Dining',
  'Gas & Fuel',
  'Rides & Transit',
  'Shopping - Clothing',
  'Shopping - Online',
  'Shopping - General',
  'Shopping - Home',
  'Entertainment',
  'Subscriptions',
  'Alcohol & Liquor',
  'Health',
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
