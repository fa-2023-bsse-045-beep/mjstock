const express = require('express');
const { query } = require('../db');
const { requireApi } = require('../auth');
const { STATUS_SQL } = require('../stock');

const router = express.Router();
const TZ = process.env.SHOP_TIMEZONE || 'Asia/Karachi';

router.get('/', requireApi('owner'), async (req, res) => {
  const [today, products, alerts, recent, smTotalsRes, salesmenRes] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(grand_total), 0) AS total, COUNT(*)::int AS count,
              COALESCE(SUM(COALESCE(balance_due, 0)), 0) AS balance_total
         FROM bills WHERE (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date`,
      [TZ]
    ),
    query('SELECT COUNT(*)::int AS n FROM products'),
    query(
      `SELECT p.id, p.name, p.part_number, p.price, p.stock_qty, p.min_stock, ${STATUS_SQL} AS status
         FROM products p WHERE p.stock_qty <= p.min_stock OR p.stock_qty <= 0
        ORDER BY p.stock_qty, LOWER(p.name)`
    ),
    query(
      `SELECT b.id, b.bill_number, b.customer_name, b.grand_total, b.advance_paid, b.balance_due, b.created_at, u.name AS cashier_name
         FROM bills b LEFT JOIN users u ON u.id = b.created_by
        ORDER BY b.created_at DESC, b.id DESC LIMIT 8`
    ),
    query(`SELECT
      COALESCE((SELECT COUNT(*) FROM salesman_bills), 0)::int AS bill_count,
      COALESCE((SELECT SUM(grand_total) FROM salesman_bills), 0) AS total_bills_amount,
      COALESCE((SELECT SUM(amount) FROM salesman_cash_payments), 0) AS total_cash_paid,
      COALESCE((SELECT SUM(amount) FROM salesman_bank_payments), 0) AS total_bank_paid,
      COALESCE((SELECT SUM(quantity) FROM salesman_bill_items), 0)::int AS total_products_delivered
    `),
    query("SELECT id, name FROM users WHERE role='salesman' AND is_active=TRUE ORDER BY LOWER(name)"),
  ]);

  const smT = smTotalsRes.rows[0];
  const smTotalBillsAmount = Number(smT.total_bills_amount);
  const smTotalCashPaid    = Number(smT.total_cash_paid);
  const smTotalBankPaid    = Number(smT.total_bank_paid);
  const smTotalPaid        = Math.round((smTotalCashPaid + smTotalBankPaid) * 100) / 100;
  const smTotalOutstanding = Math.max(0, Math.round((smTotalBillsAmount - smTotalPaid) * 100) / 100);

  const salesmenSummaries = await Promise.all(salesmenRes.rows.map(async (s) => {
    const [b, c, bk] = await Promise.all([
      query('SELECT COUNT(*)::int AS cnt, COALESCE(SUM(grand_total), 0) AS total FROM salesman_bills WHERE salesman_id = $1', [s.id]),
      query('SELECT COALESCE(SUM(amount), 0) AS total FROM salesman_cash_payments WHERE salesman_id = $1', [s.id]),
      query('SELECT COALESCE(SUM(amount), 0) AS total FROM salesman_bank_payments WHERE salesman_id = $1', [s.id]),
    ]);
    const billAmt = Number(b.rows[0].total);
    const cash = Number(c.rows[0].total);
    const bank = Number(bk.rows[0].total);
    const paid = Math.round((cash + bank) * 100) / 100;
    const balance = Math.max(0, Math.round((billAmt - paid) * 100) / 100);
    return {
      id: s.id,
      name: s.name,
      bill_count: b.rows[0].cnt,
      total_bill_amount: billAmt,
      cash_paid: cash,
      bank_paid: bank,
      total_paid: paid,
      remaining_balance: balance,
    };
  }));

  res.json({
    today: today.rows[0],
    productCount: products.rows[0].n,
    alerts: alerts.rows,
    recentBills: recent.rows,
    salesmenOverview: {
      totals: {
        total_bills: smT.bill_count,
        total_bill_amount: smTotalBillsAmount,
        total_cash: smTotalCashPaid,
        total_bank: smTotalBankPaid,
        total_paid: smTotalPaid,
        total_pending: smTotalOutstanding,
        total_products_delivered: Number(smT.total_products_delivered),
      },
      salesmen: salesmenSummaries,
    },
  });
});

module.exports = router;
