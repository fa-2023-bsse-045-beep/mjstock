const express = require('express');
const { query } = require('../db');
const { requireApi } = require('../auth');
const { STATUS_SQL } = require('../stock');

const router = express.Router();
const TZ = process.env.SHOP_TIMEZONE || 'Asia/Karachi';

router.get('/', requireApi('owner'), async (req, res) => {
  const [today, products, alerts, recent] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(grand_total), 0) AS total, COUNT(*)::int AS count
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
      `SELECT b.id, b.bill_number, b.customer_name, b.grand_total, b.created_at, u.name AS cashier_name
         FROM bills b LEFT JOIN users u ON u.id = b.created_by
        ORDER BY b.created_at DESC, b.id DESC LIMIT 8`
    ),
  ]);
  res.json({
    today: today.rows[0],
    productCount: products.rows[0].n,
    alerts: alerts.rows,
    recentBills: recent.rows,
  });
});

module.exports = router;
