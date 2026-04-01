import express from 'express';
import cors from 'cors';
import multer from 'multer';
import db from './db.js';
import { parseBMOStatement } from './parser.js';
import { saveCategoryMapping } from './categorize.js';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Upload and parse a PDF statement
app.post('/api/statements/upload', (req, res) => {
  upload.single('file')(req, res, (multerErr) => {
    if (multerErr) {
      res.status(400).json({ error: String(multerErr) });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    parseBMOStatement(req.file.buffer)
      .then((parsed) => {
        // Check for duplicate
        const existing = db
          .prepare('SELECT id FROM statements WHERE statement_date = ?')
          .get(parsed.statement_date) as { id: number } | undefined;

        if (existing) {
          res.status(409).json({ error: 'Statement already uploaded', statementId: existing.id });
          return;
        }

        const insertStmt = db.prepare(
          'INSERT INTO statements (filename, statement_date, period_start, period_end, total_balance) VALUES (?, ?, ?, ?, ?)'
        );
        const result = insertStmt.run(
          req.file!.originalname,
          parsed.statement_date,
          parsed.period_start,
          parsed.period_end,
          parsed.total_balance
        );
        const statementId = result.lastInsertRowid;

        const insertTxn = db.prepare(
          'INSERT INTO transactions (statement_id, trans_date, posting_date, description, amount, is_credit, cardholder, category, confirmed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        const insertMany = db.transaction((txns: typeof parsed.transactions) => {
          for (const txn of txns) {
            insertTxn.run(
              statementId, txn.trans_date, txn.posting_date, txn.description,
              txn.amount, txn.is_credit ? 1 : 0, txn.cardholder, txn.category,
              txn.confirmed ? 1 : 0
            );
          }
        });

        insertMany(parsed.transactions);
        res.json({ statementId, transactionCount: parsed.transactions.length });
      })
      .catch((err) => {
        console.error('Parse error:', err);
        res.status(500).json({ error: 'Failed to parse statement', detail: String(err) });
      });
  });
});

// Get all statements
app.get('/api/statements', (_req, res) => {
  const statements = db.prepare('SELECT * FROM statements ORDER BY statement_date DESC').all();
  res.json(statements);
});

// Delete a statement and its transactions
app.delete('/api/statements/:id', (req, res) => {
  db.prepare('DELETE FROM statements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Get transactions with filters
app.get('/api/transactions', (req, res) => {
  const { startDate, endDate, category, cardholder, confirmed } = req.query;
  let sql = 'SELECT * FROM transactions WHERE 1=1';
  const params: unknown[] = [];

  if (startDate) { sql += ' AND trans_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND trans_date <= ?'; params.push(endDate); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (cardholder) { sql += ' AND cardholder = ?'; params.push(cardholder); }
  if (confirmed === 'false') { sql += ' AND confirmed = 0'; }
  if (confirmed === 'true') { sql += ' AND confirmed = 1'; }

  sql += ' ORDER BY trans_date DESC';
  res.json(db.prepare(sql).all(...params));
});

// Update a transaction's category
app.patch('/api/transactions/:id/category', (req, res) => {
  const { category, merchantPattern } = req.body;
  db.prepare('UPDATE transactions SET category = ?, confirmed = 1 WHERE id = ?').run(category, req.params.id);

  if (merchantPattern) {
    saveCategoryMapping(merchantPattern, category);
    const unconfirmed = db.prepare('SELECT id, description FROM transactions WHERE confirmed = 0').all() as {
      id: number; description: string;
    }[];
    for (const txn of unconfirmed) {
      if (txn.description.toLowerCase().includes(merchantPattern.toLowerCase())) {
        db.prepare('UPDATE transactions SET category = ?, confirmed = 1 WHERE id = ?').run(category, txn.id);
      }
    }
  }

  res.json({ ok: true });
});

// Confirm a transaction's current category
app.patch('/api/transactions/:id/confirm', (req, res) => {
  const { merchantPattern } = req.body;
  const txn = db.prepare('SELECT category, description FROM transactions WHERE id = ?').get(req.params.id) as {
    category: string; description: string;
  };

  db.prepare('UPDATE transactions SET confirmed = 1 WHERE id = ?').run(req.params.id);

  if (merchantPattern && txn) {
    saveCategoryMapping(merchantPattern, txn.category);
  }

  res.json({ ok: true });
});

// Bulk confirm all
app.post('/api/transactions/confirm-all', (_req, res) => {
  db.prepare('UPDATE transactions SET confirmed = 1 WHERE confirmed = 0').run();
  res.json({ ok: true });
});

// Helper to add common filters
function addFilters(sql: string, params: unknown[], query: Record<string, unknown>) {
  if (query.startDate) { sql += ' AND trans_date >= ?'; params.push(query.startDate); }
  if (query.endDate) { sql += ' AND trans_date <= ?'; params.push(query.endDate); }
  if (query.cardholder) { sql += ' AND cardholder = ?'; params.push(query.cardholder); }
  if (query.statementId) { sql += ' AND statement_id = ?'; params.push(query.statementId); }
  return sql;
}

// Stats: by category
app.get('/api/stats/by-category', (req, res) => {
  const params: unknown[] = [];
  let sql = addFilters(`SELECT category, SUM(amount) as total, COUNT(*) as count FROM transactions WHERE is_credit = 0`, params, req.query as Record<string, unknown>);
  sql += ' GROUP BY category ORDER BY total DESC';
  res.json(db.prepare(sql).all(...params));
});

// Stats: per statement with category breakdown
app.get('/api/stats/per-statement', (req, res) => {
  const { cardholder } = req.query;
  let sql = `SELECT s.id as statement_id, s.statement_date, s.period_start, s.period_end,
    t.category, SUM(t.amount) as total
    FROM transactions t JOIN statements s ON t.statement_id = s.id
    WHERE t.is_credit = 0`;
  const params: unknown[] = [];
  if (cardholder) { sql += ' AND t.cardholder = ?'; params.push(cardholder); }
  sql += ' GROUP BY s.id, t.category ORDER BY s.statement_date, t.category';
  res.json(db.prepare(sql).all(...params));
});

// Stats: monthly totals (kept for yearly view)
app.get('/api/stats/monthly', (req, res) => {
  const params: unknown[] = [];
  let sql = addFilters(`SELECT strftime('%Y-%m', trans_date) as month, SUM(amount) as total FROM transactions WHERE is_credit = 0`, params, req.query as Record<string, unknown>);
  sql += " GROUP BY strftime('%Y-%m', trans_date) ORDER BY month";
  res.json(db.prepare(sql).all(...params));
});

// Stats: daily spending totals
app.get('/api/stats/daily', (req, res) => {
  const params: unknown[] = [];
  let sql = addFilters(`SELECT trans_date, SUM(amount) as total, COUNT(*) as count FROM transactions WHERE is_credit = 0`, params, req.query as Record<string, unknown>);
  sql += ' GROUP BY trans_date ORDER BY trans_date';
  res.json(db.prepare(sql).all(...params));
});

// Category mappings
app.get('/api/category-mappings', (_req, res) => {
  res.json(db.prepare('SELECT * FROM category_mappings ORDER BY merchant_pattern').all());
});

app.delete('/api/category-mappings/:id', (req, res) => {
  db.prepare('DELETE FROM category_mappings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Cardholders
app.get('/api/cardholders', (_req, res) => {
  res.json(db.prepare('SELECT DISTINCT cardholder FROM transactions ORDER BY cardholder').all());
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
