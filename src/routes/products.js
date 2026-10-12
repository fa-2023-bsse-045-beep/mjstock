const express = require('express');
const { query, withTransaction } = require('../db');
const v = require('../validate');
const { requireApi } = require('../auth');
const { STATUS_SQL } = require('../stock');

const router = express.Router();
const owner = requireApi('owner');

const SELECT = `SELECT p.id, p.name, p.price, p.stock_qty, p.min_stock, p.created_at, ${STATUS_SQL} AS status FROM products p`;

function readProduct(body = {}) {
  return {
    name: v.text(body.name, 'Product name', { required: true, max: 150 }),
    price: v.amount(body.price, 'Price', { max: 10000000 }),
    stock_qty: v.integer(body.stock_qty, 'Stock quantity', { min: 0, max: 1000000 }),
    min_stock: v.integer(body.min_stock, 'Minimum stock', { min: 0, max: 1000000 }),
  };
}

// All logged-in users (cashiers need the list to make bills).
router.get('/', requireApi(), async (req, res) => {
  const { rows } = await query(`${SELECT} ORDER BY LOWER(p.name)`);
  res.json({ products: rows });
});

// Products that are low or out of stock (bell + dashboard).
router.get('/alerts', requireApi(), async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE p.stock_qty <= p.min_stock OR p.stock_qty <= 0 ORDER BY p.stock_qty, LOWER(p.name)`);
  res.json({ products: rows });
});

router.post('/', owner, async (req, res) => {
  const p = readProduct(req.body);
  const product = await withTransaction(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO products (name, price, stock_qty, min_stock) VALUES ($1, $2, $3, $4) RETURNING id',
      [p.name, p.price, p.stock_qty, p.min_stock]
    );
    const id = rows[0].id;
    if (p.stock_qty > 0) {
      await c.query(
        `INSERT INTO stock_movements (product_id, change_qty, reason, note, user_id) VALUES ($1, $2, 'restock', 'Opening stock', $3)`,
        [id, p.stock_qty, req.user.id]
      );
    }
    return (await c.query(`${SELECT} WHERE p.id = $1`, [id])).rows[0];
  });
  res.status(201).json({ product });
});

router.put('/:id', owner, async (req, res) => {
  const id = v.id(req.params.id);
  const p = readProduct(req.body);
  const product = await withTransaction(async (c) => {
    const cur = await c.query('SELECT stock_qty FROM products WHERE id = $1 FOR UPDATE', [id]);
    if (!cur.rows.length) throw new v.HttpError(404, 'Product not found');
    const diff = p.stock_qty - cur.rows[0].stock_qty;
    await c.query('UPDATE products SET name = $1, price = $2, stock_qty = $3, min_stock = $4 WHERE id = $5', [
      p.name, p.price, p.stock_qty, p.min_stock, id,
    ]);
    if (diff !== 0) {
      await c.query(
        `INSERT INTO stock_movements (product_id, change_qty, reason, note, user_id) VALUES ($1, $2, 'adjustment', 'Edited by owner', $3)`,
        [id, diff, req.user.id]
      );
    }
    return (await c.query(`${SELECT} WHERE p.id = $1`, [id])).rows[0];
  });
  res.json({ product });
});

router.delete('/:id', owner, async (req, res) => {
  const id = v.id(req.params.id);
  const { rowCount } = await query('DELETE FROM products WHERE id = $1', [id]);
  if (!rowCount) throw new v.HttpError(404, 'Product not found');
  res.json({ ok: true });
});

router.post('/:id/restock', owner, async (req, res) => {
  const id = v.id(req.params.id);
  const qty = v.integer(req.body && req.body.quantity, 'Quantity', { min: 1, max: 100000 });
  const note = v.text(req.body && req.body.note, 'Note', { max: 200 });
  const product = await withTransaction(async (c) => {
    const upd = await c.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2 RETURNING id', [qty, id]);
    if (!upd.rowCount) throw new v.HttpError(404, 'Product not found');
    await c.query(
      `INSERT INTO stock_movements (product_id, change_qty, reason, note, user_id) VALUES ($1, $2, 'restock', $3, $4)`,
      [id, qty, note || null, req.user.id]
    );
    return (await c.query(`${SELECT} WHERE p.id = $1`, [id])).rows[0];
  });
  res.json({ product });
});

module.exports = router;
