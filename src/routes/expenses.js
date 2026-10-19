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
  const y = v.integer(year,  'Year',  { min: 2000, max: 2100 });
  const m = v.integer(month, 'Month', { min: 1,    max: 12   });
  return { y, m };
}

// Reliable month filter — EXTRACT works perfectly with $n params.
// Returns the WHERE clause fragment and adds y, m to params array.
function monthClause(col, params, y, m) {
  params.push(y, m);
  const pi = params.length;
  return `(EXTRACT(YEAR  FROM ${col})::int = $${pi - 1}
      AND  EXTRACT(MONTH FROM ${col})::int = $${pi})`;
}

// ── POST /api/expenses  (cashier OR owner) ─────────────────────────────────
router.post('/', requireApi('owner', 'cashier'), async (req, res) => {
  const amount  = v.amount(req.body.amount,  'Amount',  { min: 0.01, max: 100000000 });
  const purpose = v.text(req.body.purpose,   'Purpose', { required: true,  max: 150  });
  const notes   = v.text(req.body.notes,     'Notes',   { required: false, max: 1000 }) || null;

  const { rows } = await query(
    `INSERT INTO expenses (amount, purpose, notes, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, amount, purpose, notes, created_by, created_at`,
    [amount, purpose, notes, req.user.id]
  );

  res.status(201).json({ expense: rows[0] });
});

// ── GET /api/expenses/my  (cashier OR owner — own entries only) ───────────
router.get('/my', requireApi('owner', 'cashier'), async (req, res) => {
  const ym     = currentYearMonth();
  const year   = req.query.year  ? Number(req.query.year)  : ym.year;
  const month  = req.query.month ? Number(req.query.month) : ym.month;
  const { y, m } = validateYearMonth(year, month);
  const offset = v.integer(req.query.offset || 0, 'Offset', { min: 0, max: 10000000 });

  // ── Own entries ──────────────────────────────────────────────────────
  const eParams = [TZ, req.user.id];
  const eClause = monthClause(`e.created_at AT TIME ZONE $1`, eParams, y, m);
  const { rows } = await query(
    `SELECT e.id, e.amount, e.purpose, e.notes, e.created_at
       FROM expenses e
      WHERE e.created_by = $2 AND ${eClause}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${eParams.push(PAGE_SIZE + 1) && eParams.length} OFFSET $${eParams.push(offset) && eParams.length}`,
    eParams
  );

  // ── Monthly expense totals ─────────────────────────────────────────
  const tp = [TZ, req.user.id];
  const tc = monthClause(`e.created_at AT TIME ZONE $1`, tp, y, m);
  const totals = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses, COUNT(*)::int AS count
       FROM expenses e WHERE e.created_by = $2 AND ${tc}`,
    tp
  );

  // ── Monthly income (bills this cashier created) ────────────────────
  const ip = [TZ, req.user.id];
  const ic = monthClause(`b.created_at AT TIME ZONE $1`, ip, y, m);
  const income = await query(
    `SELECT COALESCE(SUM(grand_total), 0) AS total_income,
            COUNT(*)::int AS bill_count,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN grand_total ELSE 0 END), 0) AS cash_income,
            COALESCE(SUM(CASE WHEN payment_method = 'account' THEN grand_total ELSE 0 END), 0) AS account_income,
            COALESCE(SUM(COALESCE(balance_due, 0)), 0) AS total_due,
            COUNT(CASE WHEN balance_due IS NOT NULL AND balance_due > 0 THEN 1 END)::int AS pending_count
       FROM bills b WHERE b.created_by = $2 AND ${ic}`,
    ip
  );

  const expTotal = Number(totals.rows[0].total_expenses);
  const incTotal = Number(income.rows[0].total_income);
  const cashInc = Number(income.rows[0].cash_income);

  res.json({
    expenses: rows.slice(0, PAGE_SIZE),
    hasMore:  rows.length > PAGE_SIZE,
    summary: {
      ...totals.rows[0],
      ...income.rows[0],
      balance: incTotal - expTotal,
      cash_balance: cashInc - expTotal,
    },
    year: y,
    month: m,
  });
});

// ── GET /api/expenses  (owner only) ─────────────────────────────────────
router.get('/', requireApi('owner'), async (req, res) => {
  const ym     = currentYearMonth();
  const year   = req.query.year  ? Number(req.query.year)  : ym.year;
  const month  = req.query.month ? Number(req.query.month) : ym.month;
  const { y, m } = validateYearMonth(year, month);
  const offset    = v.integer(req.query.offset || 0, 'Offset', { min: 0, max: 10000000 });
  const q         = v.text(req.query.q, 'Search', { max: 100 }) || '';
  const cashierId = req.query.cashier_id ? v.id(req.query.cashier_id, 'Cashier') : null;

  // ── Entry list ───────────────────────────────────────────────────────
  const listParams = [TZ];
  const listWhere  = [monthClause(`e.created_at AT TIME ZONE $1`, listParams, y, m)];

  if (q) {
    const safe = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    listParams.push(safe);
    listWhere.push(`(e.purpose ILIKE $${listParams.length} OR u.name ILIKE $${listParams.length})`);
  }
  if (cashierId) {
    listParams.push(cashierId);
    listWhere.push(`e.created_by = $${listParams.length}`);
  }
  listParams.push(PAGE_SIZE + 1, offset);

  const { rows } = await query(
    `SELECT e.id, e.amount, e.purpose, e.notes, e.created_at,
            e.created_by, u.name AS cashier_name
       FROM expenses e
       JOIN users u ON u.id = e.created_by
      WHERE ${listWhere.join(' AND ')}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  // ── Overview totals ─────────────────────────────────────────────────
  const op = [TZ];
  const oc = monthClause(`created_at AT TIME ZONE $1`, op, y, m);

  const expenseOverview = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total_expenses, COUNT(*)::int AS count
       FROM expenses WHERE ${oc}`,
    op
  );

  const bp = [TZ];
  const bc = monthClause(`created_at AT TIME ZONE $1`, bp, y, m);
  const incomeOverview = await query(
    `SELECT COALESCE(SUM(grand_total), 0) AS total_income,
            COUNT(*)::int AS bill_count,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN grand_total ELSE 0 END), 0) AS cash_income,
            COALESCE(SUM(CASE WHEN payment_method = 'account' THEN grand_total ELSE 0 END), 0) AS account_income,
            COALESCE(SUM(COALESCE(balance_due, 0)), 0) AS total_due,
            COUNT(CASE WHEN balance_due IS NOT NULL AND balance_due > 0 THEN 1 END)::int AS pending_count,
            COALESCE(SUM(COALESCE(advance_paid, 0)), 0) AS advance_paid_total
       FROM bills WHERE ${bc}`,
    bp
  );

  const allTimePendingRes = await query(
    `SELECT COALESCE(SUM(balance_due), 0) AS all_time_due,
            COUNT(*)::int AS all_time_pending_count
       FROM bills
      WHERE balance_due IS NOT NULL AND balance_due > 0`
  );

  const pbp = [TZ];
  const pbc = monthClause(`b.created_at AT TIME ZONE $1`, pbp, y, m);
  const pendingBillsRes = await query(
    `SELECT b.id, b.bill_number, b.customer_name, b.customer_phone, b.vehicle_reg_no,
            b.current_mileage, b.next_mileage,
            b.grand_total, b.advance_paid, b.balance_due, b.payment_method, b.payment_account,
            b.created_at, u.name AS cashier_name
       FROM bills b
       LEFT JOIN users u ON u.id = b.created_by
      WHERE b.balance_due IS NOT NULL AND b.balance_due > 0 AND ${pbc}
      ORDER BY b.created_at DESC, b.id DESC`,
    pbp
  );

  // ── Account breakdown (bills paid via bank / online account) ────────
  const ap = [TZ];
  const ac = monthClause(`created_at AT TIME ZONE $1`, ap, y, m);
  const byAccount = await query(
    `SELECT COALESCE(payment_account, 'Other Account') AS account_name,
            COALESCE(SUM(grand_total), 0) AS total,
            COUNT(*)::int AS count
       FROM bills
      WHERE payment_method = 'account' AND ${ac}
      GROUP BY payment_account
      ORDER BY total DESC`,
    ap
  );

  // ── Purpose breakdown ────────────────────────────────────────────────
  const pp = [TZ];
  const pc = monthClause(`created_at AT TIME ZONE $1`, pp, y, m);
  const byPurpose = await query(
    `SELECT purpose, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
       FROM expenses WHERE ${pc}
      GROUP BY purpose ORDER BY total DESC`,
    pp
  );

  // ── Cashier breakdown ────────────────────────────────────────────────
  const cp = [TZ];
  const cc = monthClause(`e.created_at AT TIME ZONE $1`, cp, y, m);
  const byCashier = await query(
    `SELECT e.created_by, u.name AS cashier_name,
            COALESCE(SUM(e.amount), 0) AS total_expenses, COUNT(*)::int AS count
       FROM expenses e JOIN users u ON u.id = e.created_by
      WHERE ${cc}
      GROUP BY e.created_by, u.name ORDER BY total_expenses DESC`,
    cp
  );

  const ei = expenseOverview.rows[0];
  const ii = incomeOverview.rows[0];
  const atp = allTimePendingRes.rows[0];
  const expTotal = Number(ei.total_expenses);
  const incTotal = Number(ii.total_income);
  const cashInc  = Number(ii.cash_income);

  res.json({
    expenses:  rows.slice(0, PAGE_SIZE),
    hasMore:   rows.length > PAGE_SIZE,
    summary: {
      total_expenses: ei.total_expenses,
      expense_count:  ei.count,
      total_income:   ii.total_income,
      cash_income:    ii.cash_income,
      account_income: ii.account_income,
      total_due:      ii.total_due,
      pending_count:  ii.pending_count,
      advance_paid_total: ii.advance_paid_total,
      all_time_due:   atp.all_time_due,
      all_time_pending_count: atp.all_time_pending_count,
      bill_count:     ii.bill_count,
      balance:        incTotal - expTotal,
      cash_in_hand:   cashInc - expTotal,
    },
    pendingBills: pendingBillsRes.rows,
    byPurpose:  byPurpose.rows,
    byCashier:  byCashier.rows,
    byAccount:  byAccount.rows,
    year: y,
    month: m,
  });
});

// ── GET /api/expenses/:id  (owner: any; cashier: own only) ─────────────────
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

module.exports = router;
