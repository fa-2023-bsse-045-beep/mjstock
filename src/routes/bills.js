const express = require('express');
const { query, withTransaction } = require('../db');
const v = require('../validate');
const { requireApi } = require('../auth');
const { stockStatus } = require('../stock');
const { notifyLowStock } = require('../notify');

const router = express.Router();
const TZ = process.env.SHOP_TIMEZONE || 'Asia/Karachi';
const PAGE_SIZE = 50;

const cents = (n) => Math.round(n * 100);
const rupees = (c) => c / 100;

function readBill(body = {}) {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new v.HttpError(400, 'Cart is empty');
  if (body.items.length > 200) throw new v.HttpError(400, 'Too many items on one bill');

  const items = body.items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new v.HttpError(400, `Item ${i + 1} is invalid`);
    const quantity = v.integer(it.quantity, `Quantity of item ${i + 1}`, { min: 1, max: 100000 });
    if (it.product_id !== undefined && it.product_id !== null) {
      return {
        product_id: v.id(it.product_id, 'Product'),
        quantity,
        part_number: v.text(it.part_number, 'Part number', { required: false, max: 100 }) || null,
      };
    }
    return {
      product_id: null,
      name: v.text(it.name, `Name of item ${i + 1}`, { required: true, max: 150 }),
      part_number: v.text(it.part_number, `Part number of item ${i + 1}`, { required: false, max: 100 }) || null,
      price: v.amount(it.price, `Price of item ${i + 1}`, { max: 10000000 }),
      quantity,
    };
  });

  const discountType = v.oneOf(body.discount_type, 'Discount type', ['amount', 'percent'], 'amount');
  const discountValue = discountType === 'percent'
    ? v.amount(body.discount_value, 'Discount', { max: 100, required: false })
    : v.amount(body.discount_value, 'Discount', { max: 100000000, required: false });

  const paymentMethod = v.oneOf(body.payment_method, 'Payment method', ['cash', 'account'], 'cash');
  const paymentAccount = paymentMethod === 'account'
    ? v.text(body.payment_account, 'Account name', { required: true, max: 100 })
    : null;

  return {
    customer_name: v.text(body.customer_name, 'Customer name', { max: 100 }) || null,
    discountType,
    discountValue,
    paymentMethod,
    paymentAccount,
    items,
  };
}

async function loadBill(clientOrPool, id) {
  const b = await clientOrPool.query(
    `SELECT b.id, b.bill_number, b.customer_name, b.subtotal, b.discount, b.grand_total,
            b.payment_method, b.payment_account, b.created_at,
            b.created_by, u.name AS cashier_name
       FROM bills b LEFT JOIN users u ON u.id = b.created_by
      WHERE b.id = $1`,
    [id]
  );
  if (!b.rows.length) return null;
  const items = await clientOrPool.query(
    'SELECT id, product_id, item_name, part_number, price, quantity, line_total FROM bill_items WHERE bill_id = $1 ORDER BY id',
    [id]
  );
  return { ...b.rows[0], items: items.rows };
}

// Create a bill: saves bill + items, reduces stock and logs stock movements in ONE transaction.
router.post('/', requireApi('owner', 'cashier'), async (req, res) => {
  const input = readBill(req.body);

  const { bill, alerts } = await withTransaction(async (c) => {
    // Lock the products being sold so two counters can't oversell the same stock.
    const ids = [...new Set(input.items.filter((i) => i.product_id).map((i) => i.product_id))].sort((a, b) => a - b);
    const products = new Map();
    if (ids.length) {
      const { rows } = await c.query(
        'SELECT id, name, part_number, price, stock_qty, min_stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
        [ids]
      );
      rows.forEach((p) => products.set(p.id, p));
    }

    const needed = new Map();
    for (const it of input.items) {
      if (!it.product_id) continue;
      if (!products.has(it.product_id)) throw new v.HttpError(409, 'A product in the cart no longer exists. Please refresh.');
      needed.set(it.product_id, (needed.get(it.product_id) || 0) + it.quantity);
    }
    for (const [pid, qty] of needed) {
      const p = products.get(pid);
      if (p.stock_qty <= 0) throw new v.HttpError(409, `${p.name} is OUT OF STOCK`);
      if (qty > p.stock_qty) throw new v.HttpError(409, `Only ${p.stock_qty} of ${p.name} in stock (cart has ${qty})`);
    }

    // Prices of stock products always come from the database, not the browser.
    const lines = input.items.map((it) => {
      const p = it.product_id ? products.get(it.product_id) : null;
      const priceC = cents(p ? p.price : it.price);
      return {
        product_id: it.product_id,
        name: p ? p.name : it.name,
        part_number: p ? p.part_number : (it.part_number || null),
        priceC,
        quantity: it.quantity,
        totalC: priceC * it.quantity,
      };
    });
    const subtotalC = lines.reduce((s, l) => s + l.totalC, 0);
    let discountC = input.discountType === 'percent'
      ? Math.round((subtotalC * input.discountValue) / 100)
      : cents(input.discountValue);
    discountC = Math.min(discountC, subtotalC);
    const grandC = subtotalC - discountC;

    const ins = await c.query(
      `INSERT INTO bills (customer_name, subtotal, discount, grand_total, payment_method, payment_account, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, bill_number`,
      [input.customer_name, rupees(subtotalC), rupees(discountC), rupees(grandC), input.paymentMethod, input.paymentAccount, req.user.id]
    );
    const { id: billId, bill_number: billNumber } = ins.rows[0];

    await c.query(
      `INSERT INTO bill_items (bill_id, product_id, item_name, part_number, price, quantity, line_total)
       SELECT $1::int, * FROM unnest($2::int[], $3::text[], $4::text[], $5::numeric[], $6::int[], $7::numeric[])`,
      [
        billId,
        lines.map((l) => l.product_id),
        lines.map((l) => l.name),
        lines.map((l) => l.part_number),
        lines.map((l) => rupees(l.priceC)),
        lines.map((l) => l.quantity),
        lines.map((l) => rupees(l.totalC)),
      ]
    );

    const alerts = [];
    for (const [pid, qty] of needed) {
      const upd = await c.query(
        'UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2 RETURNING id, name, stock_qty, min_stock',
        [qty, pid]
      );
      await c.query(
        `INSERT INTO stock_movements (product_id, change_qty, reason, note, bill_id, user_id)
         VALUES ($1, $2, 'sale', $3, $4, $5)`,
        [pid, -qty, `Bill #${billNumber}`, billId, req.user.id]
      );
      const p = upd.rows[0];
      const status = stockStatus(p.stock_qty, p.min_stock);
      if (status !== 'ok') alerts.push({ ...p, status });
    }

    return { bill: await loadBill(c, billId), alerts };
  });

  // Email/WhatsApp alerts (once per product per day). On serverless we must finish before responding.
  const pending = notifyLowStock(alerts);
  if (process.env.VERCEL) await pending;

  res.status(201).json({ bill, alerts });
});

// Bill history (owner only).
router.get('/', requireApi('owner'), async (req, res) => {
  const q = v.text(req.query.q, 'Search', { max: 100 });
  const date = req.query.date ? String(req.query.date) : '';
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new v.HttpError(400, 'Invalid date');
  const paymentMethod = req.query.payment_method ? String(req.query.payment_method) : '';
  const offset = v.integer(req.query.offset || 0, 'Offset', { min: 0, max: 10000000 });

  const where = [];
  const params = [TZ];
  if (q) {
    const digits = q.replace(/^#/, '');
    if (/^\d{1,15}$/.test(digits)) {
      params.push(Number(digits));
      where.push(`(b.bill_number = $${params.length} OR b.customer_name ILIKE $${params.length + 1} OR b.payment_account ILIKE $${params.length + 1})`);
    } else {
      where.push(`(b.customer_name ILIKE $${params.length + 1} OR b.payment_account ILIKE $${params.length + 1})`);
    }
    params.push(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
  }
  if (date) {
    params.push(date);
    where.push(`(b.created_at AT TIME ZONE $1)::date = $${params.length}::date`);
  }
  if (paymentMethod && ['cash', 'account'].includes(paymentMethod)) {
    params.push(paymentMethod);
    where.push(`b.payment_method = $${params.length}`);
  }
  params.push(PAGE_SIZE + 1, offset);

  const { rows } = await query(
    `SELECT b.id, b.bill_number, b.customer_name, b.subtotal, b.discount, b.grand_total,
            b.payment_method, b.payment_account, b.created_at,
            u.name AS cashier_name,
            (SELECT COALESCE(SUM(quantity), 0) FROM bill_items bi WHERE bi.bill_id = b.id)::int AS item_count,
            to_char(b.created_at AT TIME ZONE $1, 'YYYY-MM-DD') AS local_date
       FROM bills b LEFT JOIN users u ON u.id = b.created_by
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const today = await query(
    `SELECT COALESCE(SUM(grand_total), 0) AS total,
            COUNT(*)::int AS count,
            COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN grand_total ELSE 0 END), 0) AS cash_total,
            COALESCE(SUM(CASE WHEN payment_method = 'account' THEN grand_total ELSE 0 END), 0) AS account_total
       FROM bills WHERE (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date`,
    [TZ]
  );

  res.json({
    bills: rows.slice(0, PAGE_SIZE),
    hasMore: rows.length > PAGE_SIZE,
    today: today.rows[0],
  });
});

// One bill (owner: any bill; cashier: only bills they created, for printing).
router.get('/:id', requireApi('owner', 'cashier'), async (req, res) => {
  const bill = await loadBill({ query }, v.id(req.params.id));
  if (!bill || (req.user.role !== 'owner' && bill.created_by !== req.user.id)) {
    throw new v.HttpError(404, 'Bill not found');
  }
  res.json({ bill });
});

// Delete a bill and give the stock back (owner only).
router.delete('/:id', requireApi('owner'), async (req, res) => {
  const id = v.id(req.params.id);
  await withTransaction(async (c) => {
    const b = await c.query('SELECT id, bill_number FROM bills WHERE id = $1 FOR UPDATE', [id]);
    if (!b.rows.length) throw new v.HttpError(404, 'Bill not found');
    const billNumber = b.rows[0].bill_number;

    const items = await c.query(
      `SELECT product_id, SUM(quantity)::int AS qty FROM bill_items
        WHERE bill_id = $1 AND product_id IS NOT NULL GROUP BY product_id ORDER BY product_id`,
      [id]
    );
    for (const it of items.rows) {
      const upd = await c.query('UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2', [it.qty, it.product_id]);
      if (upd.rowCount) {
        await c.query(
          `INSERT INTO stock_movements (product_id, change_qty, reason, note, user_id)
           VALUES ($1, $2, 'adjustment', $3, $4)`,
          [it.product_id, it.qty, `Bill #${billNumber} deleted - stock returned`, req.user.id]
        );
      }
    }
    await c.query('DELETE FROM bills WHERE id = $1', [id]);
  });
  res.json({ ok: true });
});

module.exports = router;
