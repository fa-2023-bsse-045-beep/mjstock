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

function readBill(body = {}, allowPriceOverride = false) {
  if (!Array.isArray(body.items) || body.items.length === 0) throw new v.HttpError(400, 'Cart is empty');
  if (body.items.length > 200) throw new v.HttpError(400, 'Too many items on one bill');

  const items = body.items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new v.HttpError(400, `Item ${i + 1} is invalid`);
    const quantity = v.integer(it.quantity, `Quantity of item ${i + 1}`, { min: 1, max: 100000 });
    if (it.product_id !== undefined && it.product_id !== null) {
      const price = (allowPriceOverride && it.price !== undefined && it.price !== null)
        ? v.amount(it.price, `Price of item ${i + 1}`, { max: 10000000 })
        : null;
      return {
        product_id: v.id(it.product_id, 'Product'),
        quantity,
        name: v.text(it.name, `Name of item ${i + 1}`, { required: false, max: 150 }) || null,
        part_number: v.text(it.part_number, 'Part number', { required: false, max: 100 }) || null,
        price,
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

  let advancePaid = null;
  if (body.advance_paid !== undefined && body.advance_paid !== null && String(body.advance_paid).trim() !== '') {
    advancePaid = v.amount(body.advance_paid, 'Advance amount', { min: 0, max: 100000000, required: false });
  }

  return {
    customer_name: v.text(body.customer_name, 'Customer name', { max: 100 }) || null,
    customer_phone: v.text(body.customer_phone, 'Phone number', { max: 50 }) || null,
    vehicle_reg_no: v.text(body.vehicle_reg_no, 'Registration number', { max: 50 }) || null,
    current_mileage: v.text(body.current_mileage, 'Current mileage', { max: 50 }) || null,
    next_mileage: v.text(body.next_mileage, 'Next mileage', { max: 50 }) || null,
    discountType,
    discountValue,
    advancePaid,
    paymentMethod,
    paymentAccount,
    items,
  };
}

async function loadBill(clientOrPool, id) {
  const b = await clientOrPool.query(
    `SELECT b.id, b.bill_number, b.customer_name, b.customer_phone, b.vehicle_reg_no, b.current_mileage, b.next_mileage,
            b.subtotal, b.discount, b.grand_total,
            b.advance_paid, b.balance_due,
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

    let advanceC = null;
    let balanceC = null;
    if (input.advancePaid !== null && input.advancePaid !== undefined) {
      advanceC = cents(input.advancePaid);
      if (advanceC > grandC) {
        throw new v.HttpError(400, `Advance amount (Rs. ${rupees(advanceC)}) cannot exceed Grand Total (Rs. ${rupees(grandC)})`);
      }
      balanceC = grandC - advanceC;
    }

    const ins = await c.query(
      `INSERT INTO bills (
        customer_name, customer_phone, vehicle_reg_no, current_mileage, next_mileage,
        subtotal, discount, grand_total, advance_paid, balance_due, payment_method, payment_account, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, bill_number`,
      [
        input.customer_name,
        input.customer_phone,
        input.vehicle_reg_no,
        input.current_mileage,
        input.next_mileage,
        rupees(subtotalC),
        rupees(discountC),
        rupees(grandC),
        advanceC !== null ? rupees(advanceC) : null,
        balanceC !== null ? rupees(balanceC) : null,
        input.paymentMethod,
        input.paymentAccount,
        req.user.id
      ]
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
  const balanceStatus = req.query.balance_status ? String(req.query.balance_status) : '';
  const offset = v.integer(req.query.offset || 0, 'Offset', { min: 0, max: 10000000 });

  const where = [];
  const params = [TZ];
  if (q) {
    const digits = q.replace(/^#/, '');
    if (/^\d{1,15}$/.test(digits)) {
      params.push(Number(digits));
      where.push(`(b.bill_number = $${params.length} OR b.customer_name ILIKE $${params.length + 1} OR b.customer_phone ILIKE $${params.length + 1} OR b.vehicle_reg_no ILIKE $${params.length + 1} OR b.payment_account ILIKE $${params.length + 1})`);
    } else {
      where.push(`(b.customer_name ILIKE $${params.length + 1} OR b.customer_phone ILIKE $${params.length + 1} OR b.vehicle_reg_no ILIKE $${params.length + 1} OR b.payment_account ILIKE $${params.length + 1})`);
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
  if (balanceStatus === 'pending') {
    where.push('b.balance_due IS NOT NULL AND b.balance_due > 0');
  } else if (balanceStatus === 'cleared') {
    where.push('(b.balance_due IS NULL OR b.balance_due = 0)');
  }
  params.push(PAGE_SIZE + 1, offset);

  const { rows } = await query(
    `SELECT b.id, b.bill_number, b.customer_name, b.customer_phone, b.vehicle_reg_no, b.current_mileage, b.next_mileage,
            b.subtotal, b.discount, b.grand_total,
            b.advance_paid, b.balance_due,
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

  const [today, overall] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(grand_total), 0) AS total,
              COUNT(*)::int AS count,
              COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN grand_total ELSE 0 END), 0) AS cash_total,
              COALESCE(SUM(CASE WHEN payment_method = 'account' THEN grand_total ELSE 0 END), 0) AS account_total,
              COALESCE(SUM(COALESCE(balance_due, 0)), 0) AS balance_total,
              COALESCE(SUM(COALESCE(advance_paid, 0)), 0) AS advance_total
         FROM bills WHERE (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date`,
      [TZ]
    ),
    query(
      `SELECT COALESCE(SUM(balance_due), 0) AS total_pending,
              COUNT(*)::int AS pending_count
         FROM bills WHERE balance_due IS NOT NULL AND balance_due > 0`
    ),
  ]);

  res.json({
    bills: rows.slice(0, PAGE_SIZE),
    hasMore: rows.length > PAGE_SIZE,
    today: today.rows[0],
    overallPending: overall.rows[0],
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

// Update a bill: recalculates items, prices, discounts, and adjusts stock deltas (owner only).
router.put('/:id', requireApi('owner'), async (req, res) => {
  const billId = v.id(req.params.id);
  const input = readBill(req.body, true);

  const { bill, alerts } = await withTransaction(async (c) => {
    // 1. Lock bill
    const b = await c.query('SELECT id, bill_number FROM bills WHERE id = $1 FOR UPDATE', [billId]);
    if (!b.rows.length) throw new v.HttpError(404, 'Bill not found');
    const billNumber = b.rows[0].bill_number;

    // 2. Fetch existing items with product_id
    const oldItemsRes = await c.query(
      `SELECT product_id, SUM(quantity)::int AS qty
         FROM bill_items
        WHERE bill_id = $1 AND product_id IS NOT NULL
        GROUP BY product_id`,
      [billId]
    );
    const oldQtyMap = new Map();
    for (const r of oldItemsRes.rows) {
      oldQtyMap.set(r.product_id, r.qty);
    }

    // 3. New quantities per product
    const newQtyMap = new Map();
    for (const it of input.items) {
      if (it.product_id) {
        newQtyMap.set(it.product_id, (newQtyMap.get(it.product_id) || 0) + it.quantity);
      }
    }

    // 4. Union of all product IDs to lock
    const allProductIds = [...new Set([...oldQtyMap.keys(), ...newQtyMap.keys()])].sort((a, b) => a - b);
    const products = new Map();
    if (allProductIds.length) {
      const { rows } = await c.query(
        'SELECT id, name, part_number, price, stock_qty, min_stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
        [allProductIds]
      );
      rows.forEach((p) => products.set(p.id, p));
    }

    // Ensure all currently selected products exist
    for (const pid of newQtyMap.keys()) {
      if (!products.has(pid)) {
        throw new v.HttpError(409, 'A product selected for this bill no longer exists in inventory.');
      }
    }

    // 5. Stock reconciliation
    const alerts = [];
    for (const pid of allProductIds) {
      const oldQty = oldQtyMap.get(pid) || 0;
      const newQty = newQtyMap.get(pid) || 0;
      const delta = newQty - oldQty; // >0 means more sold, <0 means returned

      const p = products.get(pid);
      if (!p) continue; // If old product was deleted, skip returning stock to it

      if (delta > 0) {
        if (p.stock_qty < delta) {
          throw new v.HttpError(409, `Only ${p.stock_qty} more of ${p.name} available in stock (needed ${delta} additional)`);
        }
        const upd = await c.query(
          'UPDATE products SET stock_qty = stock_qty - $1 WHERE id = $2 RETURNING id, name, stock_qty, min_stock',
          [delta, pid]
        );
        await c.query(
          `INSERT INTO stock_movements (product_id, change_qty, reason, note, bill_id, user_id)
           VALUES ($1, $2, 'sale', $3, $4, $5)`,
          [pid, -delta, `Bill #${billNumber} updated - added qty`, billId, req.user.id]
        );
        const updatedP = upd.rows[0];
        const status = stockStatus(updatedP.stock_qty, updatedP.min_stock);
        if (status !== 'ok') alerts.push({ ...updatedP, status });
      } else if (delta < 0) {
        const returnedQty = -delta;
        await c.query(
          'UPDATE products SET stock_qty = stock_qty + $1 WHERE id = $2',
          [returnedQty, pid]
        );
        await c.query(
          `INSERT INTO stock_movements (product_id, change_qty, reason, note, bill_id, user_id)
           VALUES ($1, $2, 'adjustment', $3, $4, $5)`,
          [pid, returnedQty, `Bill #${billNumber} updated - returned qty`, billId, req.user.id]
        );
      }
    }

    // 6. Build lines
    const lines = input.items.map((it) => {
      const p = it.product_id ? products.get(it.product_id) : null;
      const priceVal = (it.price !== undefined && it.price !== null)
        ? it.price
        : (p ? p.price : it.price);
      const priceC = cents(priceVal);
      return {
        product_id: it.product_id,
        name: it.name || (p ? p.name : 'Item'),
        part_number: it.part_number !== undefined && it.part_number !== null ? it.part_number : (p ? p.part_number : null),
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

    let advanceC = null;
    let balanceC = null;
    if (input.advancePaid !== null && input.advancePaid !== undefined) {
      advanceC = cents(input.advancePaid);
      if (advanceC > grandC) {
        throw new v.HttpError(400, `Advance amount (Rs. ${rupees(advanceC)}) cannot exceed Grand Total (Rs. ${rupees(grandC)})`);
      }
      balanceC = grandC - advanceC;
    }

    // 7. Replace bill_items
    await c.query('DELETE FROM bill_items WHERE bill_id = $1', [billId]);
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

    // 8. Update bills table
    await c.query(
      `UPDATE bills
          SET customer_name = $1,
              customer_phone = $2,
              vehicle_reg_no = $3,
              current_mileage = $4,
              next_mileage = $5,
              subtotal = $6,
              discount = $7,
              grand_total = $8,
              advance_paid = $9,
              balance_due = $10,
              payment_method = $11,
              payment_account = $12
        WHERE id = $13`,
      [
        input.customer_name,
        input.customer_phone,
        input.vehicle_reg_no,
        input.current_mileage,
        input.next_mileage,
        rupees(subtotalC),
        rupees(discountC),
        rupees(grandC),
        advanceC !== null ? rupees(advanceC) : null,
        balanceC !== null ? rupees(balanceC) : null,
        input.paymentMethod,
        input.paymentAccount,
        billId,
      ]
    );

    return { bill: await loadBill(c, billId), alerts };
  });

  const pending = notifyLowStock(alerts);
  if (process.env.VERCEL) await pending;

  res.json({ bill, alerts, message: 'Bill updated successfully' });
});

// Pay off or reduce remaining balance (owner or cashier).
router.post('/:id/pay', requireApi('owner', 'cashier'), async (req, res) => {
  const id = v.id(req.params.id);
  const markAllPaid = req.body.mark_all_paid === true || req.body.mark_all_paid === 'true';
  const paymentMethod = ['cash', 'account'].includes(req.body.payment_method) ? req.body.payment_method : 'cash';
  const paymentAccount = paymentMethod === 'account'
    ? v.text(req.body.payment_account, 'Account name', { required: true, max: 100 })
    : null;

  const result = await withTransaction(async (c) => {
    const bRes = await c.query('SELECT * FROM bills WHERE id = $1 FOR UPDATE', [id]);
    if (!bRes.rows.length) throw new v.HttpError(404, 'Bill not found');
    const b = bRes.rows[0];

    const grandTotal = Number(b.grand_total);
    const currentBal = b.balance_due !== null ? Number(b.balance_due) : 0;
    const currentPaid = b.advance_paid !== null ? Number(b.advance_paid) : (b.balance_due !== null ? Math.max(0, grandTotal - currentBal) : grandTotal);

    if (currentBal <= 0) {
      throw new v.HttpError(400, 'This bill is already fully paid (مکمل ادا ہو چکا ہے)');
    }

    let payAmount;
    if (markAllPaid) {
      payAmount = currentBal;
    } else {
      payAmount = v.amount(req.body.amount, 'Payment amount', { min: 0.01, max: 100000000 });
      if (payAmount > currentBal) {
        throw new v.HttpError(400, `Payment amount (Rs. ${payAmount}) cannot exceed remaining balance (Rs. ${currentBal})`);
      }
    }

    const newPaid = Math.min(grandTotal, Math.round((currentPaid + payAmount) * 100) / 100);
    const newBal = Math.max(0, Math.round((currentBal - payAmount) * 100) / 100);

    await c.query(
      `UPDATE bills
          SET advance_paid = $1,
              balance_due = $2,
              payment_method = CASE WHEN $3 = 'account' THEN 'account' ELSE payment_method END,
              payment_account = CASE WHEN $3 = 'account' THEN $4 ELSE payment_account END
        WHERE id = $5`,
      [newPaid, newBal, paymentMethod, paymentAccount, id]
    );

    const updated = await loadBill(c, id);
    return { bill: updated, payAmount, newBal };
  });

  res.json({
    bill: result.bill,
    message: result.newBal > 0
      ? `Payment of Rs. ${result.payAmount} received. Remaining Balance: Rs. ${result.newBal}`
      : `Payment received! Bill #${result.bill.bill_number} is now ALL PAID (مکمل ادا شدہ).`
  });
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
