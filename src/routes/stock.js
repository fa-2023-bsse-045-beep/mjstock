const express = require('express');
const { query } = require('../db');
const v = require('../validate');
const { requireApi } = require('../auth');
const { STATUS_SQL } = require('../stock');

const router = express.Router();
router.use(requireApi('owner'));

const TZ = process.env.SHOP_TIMEZONE || 'Asia/Karachi';

// CSV cell: quote everything; neutralise spreadsheet formulas in text cells.
function csvCell(value, isText) {
  let s = value === null || value === undefined ? '' : String(value);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function sendCsv(res, filename, header, rows) {
  const lines = [header.map((h) => csvCell(h, true)).join(',')];
  rows.forEach((r) => lines.push(r.map(([val, isText]) => csvCell(val, isText)).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + lines.join('\r\n')); // BOM so Excel opens UTF-8 correctly
}

function readStatus(value) {
  return v.oneOf(value || 'all', 'Status', ['all', 'ok', 'low', 'out']);
}

async function stockRows(status) {
  const params = [];
  let where = '';
  if (status !== 'all') {
    params.push(status);
    where = `WHERE ${STATUS_SQL} = $1`;
  }
  const { rows } = await query(
    `SELECT p.id, p.name, p.part_number, p.price, p.stock_qty, p.min_stock, ${STATUS_SQL} AS status
       FROM products p ${where} ORDER BY LOWER(p.name)`,
    params
  );
  return rows;
}

async function movementRows(productId, limit) {
  const { rows } = await query(
    `SELECT m.id, m.change_qty, m.reason, m.note, m.created_at, u.name AS user_name,
            to_char(m.created_at AT TIME ZONE $3, 'YYYY-MM-DD HH24:MI') AS local_time
       FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.product_id = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $2`,
    [productId, limit, TZ]
  );
  return rows;
}

router.get('/', async (req, res) => {
  const status = readStatus(req.query.status);
  const [products, counts] = await Promise.all([
    stockRows(status),
    query(`SELECT ${STATUS_SQL} AS status, COUNT(*)::int AS n FROM products p GROUP BY 1`),
  ]);
  const summary = { all: 0, ok: 0, low: 0, out: 0 };
  counts.rows.forEach((r) => { summary[r.status] = r.n; summary.all += r.n; });
  res.json({ products, summary });
});

router.get('/export.csv', async (req, res) => {
  const status = readStatus(req.query.status);
  const rows = await stockRows(status);
  const label = { ok: 'OK', low: 'Low', out: 'Out' };
  sendCsv(
    res,
    `mj-autos-stock-${status}-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Product', 'Part #', 'Price (Rs)', 'Stock', 'Minimum', 'Status'],
    rows.map((p) => [[p.name, true], [p.part_number || '', true], [p.price.toFixed(2)], [p.stock_qty], [p.min_stock], [label[p.status]]])
  );
});

router.get('/:productId/movements', async (req, res) => {
  const id = v.id(req.params.productId, 'Product');
  const p = await query(`SELECT p.id, p.name, p.part_number, p.stock_qty, p.min_stock, ${STATUS_SQL} AS status FROM products p WHERE p.id = $1`, [id]);
  if (!p.rows.length) throw new v.HttpError(404, 'Product not found');
  res.json({ product: p.rows[0], movements: await movementRows(id, 200) });
});

router.get('/:productId/movements.csv', async (req, res) => {
  const id = v.id(req.params.productId, 'Product');
  const p = await query('SELECT name FROM products WHERE id = $1', [id]);
  if (!p.rows.length) throw new v.HttpError(404, 'Product not found');
  const rows = await movementRows(id, 100000);
  const safeName = p.rows[0].name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
  sendCsv(
    res,
    `mj-autos-movements-${safeName}.csv`,
    ['Date', 'Change', 'Reason', 'Note', 'User'],
    rows.map((m) => [[m.local_time], [m.change_qty > 0 ? `+${m.change_qty}` : m.change_qty], [m.reason], [m.note, true], [m.user_name, true]])
  );
});

module.exports = router;
