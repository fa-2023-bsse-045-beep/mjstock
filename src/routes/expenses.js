const express = require('express');
const { query } = require('../db');
const v = require('../validate');
const { requireApi } = require('../auth');

const router = express.Router();
const TZ = process.env.SHOP_TIMEZONE || 'Asia/Karachi';
const PAGE_SIZE = 50;

// ── Helpers ────────────────────────────────────────────────────────────────

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function validateYearMonth(year, month) {
  const y = v.integer(year, 'Year', { min: 2000, max: 2100 });
  const m = v.integer(month, 'Month', { min: 1, max: 12 });
  return { y, m };
}

// ── POST /api/expenses  (cashier OR owner) ─────────────────────────────────
// Add an expense entry. Once submitted it is locked — no edit or delete.
router.post('/', requireApi('owner', 'cashier'), async (req, res) => {
  const amount  = v.amount(req.body.amount, 'Amount', { max: 100000000 });
  const purpose = v.text(req.body.purpose, 'Purpose', { required: true, max: 150 });
  const notes   = v.text(req.body.notes,   'Notes',   { required: false, max: 1000 }) || null;

  const { rows } = await query(
    `INSERT INTO expenses (amount, purpose, notes, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, amount, purpose, notes, created_by, created_at`,
    [amount, purpose, notes, req.user.id]
  );

  res.status(201).json({ expense: rows[0] });
});

// ── GET /api/expenses/my  (cashier OR owner — own entries only) ───────────
// The cashier's personal history. Supports ?year=&month=&offset=
router.get('/my', requireApi('owner', 'cashier'), async (req, res) => {
  const ym    = currentYearMonth();
  const year  = req.query.year  ? Number(req.query.year)  : ym.year;
  const month = req.query.month ? Number(req.query.month) : ym.month;
  const { y, m } = validateYearMonth(year, month);
  const offset = v.integer(req.query.offset || 0, 'Offset', { min: 0, max: 10000000 });

  const { rows } = await query(
    `SELECT e.id, e.amount, e.purpose, e.notes, e.created_at
       FROM expenses e
      WHERE e.created_by = $1
        AND date_trunc('month', e.created_at AT TIME ZONE $2) =
            date_trunc('month', make_timestamptz($3, $4, 1, 0, 0, 0) AT TIME ZONE $2)
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $5 OFFSET $6`,
    [req.user.id, TZ, y, m, PAGE_SIZE + 1, offset]
  );

  // Monthly totals for this user
  const totals = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses, COUNT(*)::int AS count
       FROM expenses
      WHERE created_by = $1
        AND date_trunc('month', created_at AT TIME ZONE $2) =
            date_trunc('month', make_timestamptz($3, $4, 1, 0, 0, 0) AT TIME ZONE $2)`,
    [req.user.id, TZ, y, m]
  );

  // Monthly income for this user (bills they created)
  const income = await query(
    `SELECT COALESCE(SUM(grand_total), 0) AS total_income, COUNT(*)::int AS bill_count
       FROM bills
      WHERE created_by = $1
        AND date_trunc('month', created_at AT TIME ZONE $2) =
            date_trunc('month', make_timestamptz($3, $4, 1, 0, 0, 0) AT TIME ZONE $2)`,
    [req.user.id, TZ, y, m]
  );

  res.json({
    expenses: rows.slice(0, PAGE_SIZE),
    hasMore: rows.length > PAGE_SIZE,
    summary: {
      ...totals.rows[0],
      ...income.rows[0],
      balance: Number(income.rows[0].total_income) - Number(totals.rows[0].total_expenses),
    },
    year: y,
    month: m,
  });
});

// ── GET /api/expenses  (owner only) — all entries with filters ────────────
router.get('/', requireApi('owner'), async (req, res) => {
  const ym    = currentYearMonth();
  const year  = req.query.year  ? Number(req.query.year)  : ym.year;
  const month = req.query.month ? Number(req.query.month) : ym.month;
  const { y, m } = validateYearMonth(year, month);
  const offset    = v.integer(req.query.offset || 0, 'Offset', { min: 0, max: 10000000 });
  const q         = v.text(req.query.q, 'Search', { max: 100 }) || '';
  const cashierId = req.query.cashier_id ? v.id(req.query.cashier_id, 'Cashier') : null;

  const params  = [TZ, y, m];
  const where   = [
    `date_trunc('month', e.created_at AT TIME ZONE $1) =
     date_trunc('month', make_timestamptz($2, $3, 1, 0, 0, 0) AT TIME ZONE $1)`,
  ];

  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    where.push(`(e.purpose ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
  }
  if (cashierId) {
    params.push(cashierId);
    where.push(`e.created_by = $${params.length}`);
  }

  params.push(PAGE_SIZE + 1, offset);

  const { rows } = await query(
    `SELECT e.id, e.amount, e.purpose, e.notes, e.created_at,
            e.created_by, u.name AS cashier_name
       FROM expenses e
       JOIN users u ON u.id = e.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // ── Monthly overview ──────────────────────────────────────────────────
  const overviewParams = [TZ, y, m];
  const overviewWhere  = [
    `date_trunc('month', created_at AT TIME ZONE $1) =
     date_trunc('month', make_timestamptz($2, $3, 1, 0, 0, 0) AT TIME ZONE $1)`,
  ];
  const expenseOverview = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses, COUNT(*)::int AS count
       FROM expenses WHERE ${overviewWhere.join(' AND ')}`,
    overviewParams
  );
  const incomeOverview = await query(
    `SELECT COALESCE(SUM(grand_total), 0) AS total_income, COUNT(*)::int AS bill_count
       FROM bills WHERE ${overviewWhere.join(' AND ')}`,
    overviewParams
  );

  // ── Purpose breakdown ─────────────────────────────────────────────────
  const byPurpose = await query(
    `SELECT purpose, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
       FROM expenses WHERE ${overviewWhere.join(' AND ')}
      GROUP BY purpose ORDER BY total DESC`,
    overviewParams
  );

  // ── Cashier-wise breakdown ────────────────────────────────────────────
  const byCashier = await query(
    `SELECT e.created_by, u.name AS cashier_name,
            COALESCE(SUM(e.amount), 0) AS total_expenses, COUNT(*)::int AS count
       FROM expenses e JOIN users u ON u.id = e.created_by
      WHERE ${overviewWhere.join(' AND ')}
      GROUP BY e.created_by, u.name ORDER BY total_expenses DESC`,
    overviewParams
  );

  const ei = expenseOverview.rows[0];
  const ii = incomeOverview.rows[0];

  res.json({
    expenses: rows.slice(0, PAGE_SIZE),
    hasMore:  rows.length > PAGE_SIZE,
    summary: {
      total_expenses: ei.total_expenses,
      expense_count:  ei.count,
      total_income:   ii.total_income,
      bill_count:     ii.bill_count,
      balance: Number(ii.total_income) - Number(ei.total_expenses),
    },
    byPurpose:  byPurpose.rows,
    byCashier:  byCashier.rows,
    year: y,
    month: m,
  });
});

// ── GET /api/expenses/:id  (owner: any; cashier: own only) ────────────────
router.get('/:id', requireApi('owner', 'cashier'), async (req, res) => {
  const id = v.id(req.params.id);
  const { rows } = await query(
    `SELECT e.id, e.amount, e.purpose, e.notes, e.created_at,
            e.created_by, u.name AS cashier_name
       FROM expenses e JOIN users u ON u.id = e.created_by
      WHERE e.id = $1`,
    [id]
  );
  if (!rows.length) throw new v.HttpError(404, 'Expense entry not found');
  const entry = rows[0];
  if (req.user.role !== 'owner' && entry.created_by !== req.user.id) {
    throw new v.HttpError(404, 'Expense entry not found');
  }
  res.json({ expense: entry });
});

// ── No PUT / DELETE routes — entries are permanent by design ───────────────
// Any attempt to PUT/DELETE will fall through to the 404 handler in app.js.

module.exports = router;
