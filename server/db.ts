import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(import.meta.dirname, '..', 'spending.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    statement_date TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    total_balance REAL NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id INTEGER NOT NULL REFERENCES statements(id) ON DELETE CASCADE,
    trans_date TEXT NOT NULL,
    posting_date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    is_credit INTEGER NOT NULL DEFAULT 0,
    cardholder TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    confirmed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS category_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    merchant_pattern TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL
  );
`);

export default db;
