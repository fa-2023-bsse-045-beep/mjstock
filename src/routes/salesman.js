const express = require('express');
const { query, withTransaction } = require('../db');
const v = require('../validate');
const { requireApi } = require('../auth');

const router = express.Router();
const TZ = process.env.SHOP_TIMEZONE || 'Asia/Karachi';

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
async function loadSalesmanBill(clientOrPool, id) {
  const b = await clientOrPool.query(
    `SELECT sb.id, sb.bill_number, sb.salesman_id, sb.notes, sb.subtotal, sb.grand_total, sb.created_at,
            u.name AS salesman_name,
            COALESCE((SELECT SUM(amount) FROM salesman_cash_payments WHERE bill_id = sb.id), 0) AS cash_paid,
            COALESCE((SELECT SUM(amount) FROM salesman_bank_payments WHERE bill_id = sb.id), 0) AS bank_paid,
            COALESCE((SELECT SUM(quantity) FROM salesman_bill_items WHERE bill_id = sb.id), 0)::int AS total_quantity,
            COALESCE((SELECT COUNT(*) FROM salesman_bill_items WHERE bill_id = sb.id), 0)::int AS item_count
       FROM salesman_bills sb JOIN users u ON u.id = sb.salesman_id
      WHERE sb.id = $1`,
    [id]
  );
  if (!b.rows.length) return null;
  const bill = b.rows[0];
  const items = await clientOrPool.query(
    `SELECT id, product_id, item_name, unit_price, quantity, line_total
       FROM salesman_bill_items WHERE bill_id = $1 ORDER BY id`,
    [id]
  );
  const paidAmount = Number(bill.cash_paid) + Number(bill.bank_paid);
  const remainingBalance = Math.max(0, Math.round((Number(bill.grand_total) - paidAmount) * 100) / 100);
  const status = remainingBalance <= 0 ? 'paid' : (paidAmount > 0 ? 'partial' : 'unpaid');

  const [cashList, bankList] = await Promise.all([
    clientOrPool.query('SELECT * FROM salesman_cash_payments WHERE bill_id = $1 ORDER BY payment_date DESC, id DESC', [id]),
    clientOrPool.query('SELECT * FROM salesman_bank_payments WHERE bill_id = $1 ORDER BY transfer_date DESC, id DESC', [id]),
  ]);

  return {
    ...bill,
    grand_total: Number(bill.grand_total),
    subtotal: Number(bill.subtotal),
    paid_amount: paidAmount,
    remaining_balance: remainingBalance,
    status,
    items: items.rows,
    payments: {
      cash: cashList.rows,
      bank: bankList.rows,
    },
  };
}

async function getSalesmanSummary(salesmanId) {
  const [bills, prods, cash, bank] = await Promise.all([
    query('SELECT COALESCE(SUM(grand_total),0) AS total_bills, COUNT(*)::int AS bill_count FROM salesman_bills WHERE salesman_id=$1', [salesmanId]),
    query(`SELECT COALESCE(SUM(sbi.quantity),0)::int AS total_products
             FROM salesman_bill_items sbi
             JOIN salesman_bills sb ON sb.id = sbi.bill_id
            WHERE sb.salesman_id = $1`, [salesmanId]),
    query('SELECT COALESCE(SUM(amount),0) AS total_cash FROM salesman_cash_payments WHERE salesman_id=$1', [salesmanId]),
    query('SELECT COALESCE(SUM(amount),0) AS total_bank FROM salesman_bank_payments WHERE salesman_id=$1', [salesmanId]),
  ]);
  const totalBills     = Number(bills.rows[0].total_bills);
  const totalProducts  = Number(prods.rows[0].total_products);
  const totalCash      = Number(cash.rows[0].total_cash);
  const totalBank      = Number(bank.rows[0].total_bank);
  const totalPaid      = Math.round((totalCash + totalBank) * 100) / 100;
  const pending        = Math.max(0, Math.round((totalBills - totalPaid) * 100) / 100);

  return {
    total_bills: totalBills,
    bill_count: bills.rows[0].bill_count,
    total_products_delivered: totalProducts,
    total_cash: totalCash,
    total_bank: totalBank,
    total_paid: totalPaid,
    pending,
  };
}

// ─────────────────────────────────────────────
//  SALESMAN BILLS (Product Delivery Bills)
// ─────────────────────────────────────────────

// POST /api/salesman/bills — salesman or owner records delivery bill
router.post('/bills', requireApi('owner', 'salesman'), async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }
  if (!Array.isArray(body.items) || body.items.length === 0) throw new v.HttpError(400, 'Bill must have at least one product item');
  if (body.items.length > 200) throw new v.HttpError(400, 'Too many items on one bill');

  const notes = v.text(body.notes || '', 'Notes', { required: false, max: 500 }) || null;

  const lines = body.items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new v.HttpError(400, `Item ${i + 1} invalid`);
    const item_name  = v.text(it.item_name || it.name, `Item ${i + 1} name`, { required: true, max: 150 });
    const unit_price = (it.unit_price !== undefined && it.unit_price !== null && String(it.unit_price).trim() !== '')
      ? v.amount(it.unit_price, `Item ${i + 1} price`, { min: 0, max: 10000000, required: false })
      : 0;
    const quantity   = v.integer(it.quantity, `Item ${i + 1} quantity`, { min: 1, max: 100000 });
    const product_id = (it.product_id !== undefined && it.product_id !== null) ? v.id(it.product_id, 'Product') : null;
    const line_total = Math.round(unit_price * quantity * 100) / 100;
    return { item_name, unit_price, quantity, line_total, product_id };
  });

  const subtotal    = lines.reduce((s, l) => s + l.line_total, 0);
  const grand_total = subtotal;

  const isOwner = req.user.role === 'owner';
  let salesmanId = !isOwner ? req.user.id : (body.salesman_id ? v.id(body.salesman_id, 'Salesman') : null);

  if (isOwner && !salesmanId) {
    const { rows: smList } = await query("SELECT id FROM users WHERE role='salesman' AND is_active=TRUE ORDER BY id LIMIT 2");
    if (smList.length === 1) {
      salesmanId = smList[0].id;
    } else {
      throw new v.HttpError(400, 'Please select a salesman for this delivery bill');
    }
  }

  const { rows: smCheck } = await query("SELECT id FROM users WHERE id=$1 AND role='salesman' AND is_active=TRUE", [salesmanId]);
  if (!smCheck.length) throw new v.HttpError(404, 'Salesman not found');

  const bill = await withTransaction(async (c) => {
    const ins = await c.query(
      `INSERT INTO salesman_bills (salesman_id, notes, subtotal, grand_total) VALUES ($1,$2,$3,$4) RETURNING id, bill_number`,
      [salesmanId, notes, subtotal, grand_total]
    );
    const { id: billId } = ins.rows[0];
    await c.query(
      `INSERT INTO salesman_bill_items (bill_id, product_id, item_name, unit_price, quantity, line_total)
       SELECT $1::int, * FROM unnest($2::int[], $3::text[], $4::numeric[], $5::int[], $6::numeric[])`,
      [
        billId,
        lines.map(l => l.product_id),
        lines.map(l => l.item_name),
        lines.map(l => l.unit_price),
        lines.map(l => l.quantity),
        lines.map(l => l.line_total),
      ]
    );

    // Auto-allocate any previous unlinked general payments from this salesman
    await c.query(`
      UPDATE salesman_cash_payments
         SET bill_id = $1
       WHERE id IN (
         SELECT id FROM salesman_cash_payments
          WHERE salesman_id = $2 AND bill_id IS NULL
          ORDER BY payment_date ASC, id ASC
       )
    `, [billId, salesmanId]);

    await c.query(`
      UPDATE salesman_bank_payments
         SET bill_id = $1
       WHERE id IN (
         SELECT id FROM salesman_bank_payments
          WHERE salesman_id = $2 AND bill_id IS NULL
          ORDER BY transfer_date ASC, id ASC
       )
    `, [billId, salesmanId]);

    return loadSalesmanBill(c, billId);
  });

  res.status(201).json({ bill });
});

// GET /api/salesman/bills — list bills with paid amount, outstanding balance, status
router.get('/bills', requireApi('owner', 'salesman'), async (req, res) => {
  const isOwner = req.user.role === 'owner';
  const PAGE = 50;
  const offset = v.integer(req.query.offset || 0, 'Offset', { min: 0, max: 10000000 });
  const salesmanFilter = req.query.salesman_id ? v.id(req.query.salesman_id, 'Salesman') : null;
  const dateFilter = req.query.date ? String(req.query.date) : '';
  if (dateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) throw new v.HttpError(400, 'Invalid date');
  const q = v.text(req.query.q || '', 'Search', { max: 100 });
  const statusFilter = req.query.status || req.query.payment_status || '';

  const where = [];
  const params = [];
  if (!isOwner) {
    params.push(req.user.id);
    where.push(`sb.salesman_id = $${params.length}`);
  } else if (salesmanFilter) {
    params.push(salesmanFilter);
    where.push(`sb.salesman_id = $${params.length}`);
  }
  if (dateFilter) {
    params.push(TZ, dateFilter);
    where.push(`(sb.created_at AT TIME ZONE $${params.length - 1})::date = $${params.length}::date`);
  }
  if (q) {
    const digits = q.replace(/^[#A-Za-z-]+/, '');
    if (/^\d{1,15}$/.test(digits)) {
      params.push(Number(digits), `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`);
      where.push(`(sb.bill_number = $${params.length - 1} OR u.name ILIKE $${params.length})`);
    } else {
      params.push(`%${q.replace(/[\\%_]/g, m => '\\' + m)}%`);
      where.push(`u.name ILIKE $${params.length}`);
    }
  }

  // Base query with subqueries for paid amounts and item quantities
  const baseSql = `
    SELECT sb.id, sb.bill_number, sb.salesman_id, sb.grand_total, sb.subtotal, sb.notes, sb.created_at,
           u.name AS salesman_name,
           COALESCE((SELECT COUNT(*)::int FROM salesman_bill_items bi WHERE bi.bill_id = sb.id), 0) AS item_count,
           COALESCE((SELECT SUM(quantity)::int FROM salesman_bill_items bi WHERE bi.bill_id = sb.id), 0) AS total_quantity,
           (COALESCE((SELECT SUM(amount) FROM salesman_cash_payments cp WHERE cp.bill_id = sb.id), 0) +
            COALESCE((SELECT SUM(amount) FROM salesman_bank_payments bp WHERE bp.bill_id = sb.id), 0)) AS paid_amount,
           GREATEST(0, sb.grand_total -
             (COALESCE((SELECT SUM(amount) FROM salesman_cash_payments cp WHERE cp.bill_id = sb.id), 0) +
              COALESCE((SELECT SUM(amount) FROM salesman_bank_payments bp WHERE bp.bill_id = sb.id), 0))) AS remaining_balance
      FROM salesman_bills sb
      JOIN users u ON u.id = sb.salesman_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
  `;

  let wrappedSql = `SELECT * FROM (${baseSql}) q`;
  if (statusFilter === 'paid') {
    wrappedSql += ' WHERE remaining_balance <= 0';
  } else if (statusFilter === 'unpaid') {
    wrappedSql += ' WHERE paid_amount = 0';
  } else if (statusFilter === 'partial') {
    wrappedSql += ' WHERE paid_amount > 0 AND remaining_balance > 0';
  } else if (statusFilter === 'pending') {
    wrappedSql += ' WHERE remaining_balance > 0';
  }

  params.push(PAGE + 1, offset);
  wrappedSql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await query(wrappedSql, params);

  const bills = rows.slice(0, PAGE).map(r => ({
    ...r,
    grand_total: Number(r.grand_total),
    subtotal: Number(r.subtotal),
    paid_amount: Number(r.paid_amount),
    remaining_balance: Number(r.remaining_balance),
    status: Number(r.remaining_balance) <= 0 ? 'paid' : (Number(r.paid_amount) > 0 ? 'partial' : 'unpaid'),
  }));

  res.json({ bills, hasMore: rows.length > PAGE });
});

// GET /api/salesman/bills/:id — single bill
router.get('/bills/:id', requireApi('owner', 'salesman'), async (req, res) => {
  const bill = await loadSalesmanBill({ query }, v.id(req.params.id));
  if (!bill) throw new v.HttpError(404, 'Bill not found');
  if (req.user.role !== 'owner' && bill.salesman_id !== req.user.id) throw new v.HttpError(404, 'Bill not found');
  res.json({ bill });
});

// PUT /api/salesman/bills/:id — salesman updates their own bill items, quantities, notes (admin cannot change salesman invoices)
router.put('/bills/:id', requireApi('owner', 'salesman'), async (req, res) => {
  const billId = v.id(req.params.id);
  const isOwner = req.user.role === 'owner';
  const isSalesman = req.user.role === 'salesman';

  const bCheck = await query(`
    SELECT sb.id, sb.salesman_id,
           (COALESCE((SELECT SUM(amount) FROM salesman_cash_payments cp WHERE cp.bill_id = sb.id), 0) +
            COALESCE((SELECT SUM(amount) FROM salesman_bank_payments bp WHERE bp.bill_id = sb.id), 0)) AS paid_amount
      FROM salesman_bills sb
     WHERE sb.id = $1`, [billId]);
  if (!bCheck.rows.length) throw new v.HttpError(404, 'Bill not found');
  const existingBill = bCheck.rows[0];

  // Admin cannot change invoices created by the salesman
  if (isOwner && existingBill.salesman_id !== req.user.id) {
    throw new v.HttpError(403, 'Admin cannot change invoices created by the salesman. Only the salesman can edit their invoice.');
  }

  // Salesman can only edit their own bill
  if (isSalesman && existingBill.salesman_id !== req.user.id) {
    throw new v.HttpError(403, 'You can only edit your own bills');
  }

  // Prevent editing if payment is already recorded against this bill
  if (Number(existingBill.paid_amount) > 0) {
    throw new v.HttpError(400, 'This bill cannot be modified because payments have already been recorded against it.');
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }
  if (!Array.isArray(body.items) || body.items.length === 0) throw new v.HttpError(400, 'Bill must have at least one product item');

  const notes = v.text(body.notes || '', 'Notes', { required: false, max: 500 }) || null;

  // Retrieve existing prices so prices are preserved if salesman didn't set prices
  const { rows: existingItems } = await query('SELECT product_id, item_name, unit_price FROM salesman_bill_items WHERE bill_id = $1', [billId]);
  const priceMap = new Map();
  for (const it of existingItems) {
    if (it.product_id) priceMap.set('prod_' + it.product_id, Number(it.unit_price));
    priceMap.set('name_' + it.item_name.toLowerCase(), Number(it.unit_price));
  }

  const lines = body.items.map((it, i) => {
    if (!it || typeof it !== 'object') throw new v.HttpError(400, `Item ${i + 1} invalid`);
    const item_name  = v.text(it.item_name || it.name, `Item ${i + 1} name`, { required: true, max: 150 });
    const product_id = (it.product_id !== undefined && it.product_id !== null) ? v.id(it.product_id, 'Product') : null;
    let unit_price   = (it.unit_price !== undefined && it.unit_price !== null && String(it.unit_price).trim() !== '')
      ? v.amount(it.unit_price, `Item ${i + 1} price`, { min: 0, max: 10000000, required: false })
      : 0;
    // If unit_price wasn't sent or is 0, preserve existing price
    if (unit_price === 0) {
      if (product_id && priceMap.has('prod_' + product_id)) {
        unit_price = priceMap.get('prod_' + product_id);
      } else if (priceMap.has('name_' + item_name.toLowerCase())) {
        unit_price = priceMap.get('name_' + item_name.toLowerCase());
      }
    }
    const quantity   = v.integer(it.quantity, `Item ${i + 1} quantity`, { min: 1, max: 100000 });
    const line_total = Math.round(unit_price * quantity * 100) / 100;
    return { item_name, unit_price, quantity, line_total, product_id };
  });

  const grand_total = lines.reduce((s, l) => s + l.line_total, 0);

  const bill = await withTransaction(async (c) => {
    await c.query(
      'UPDATE salesman_bills SET notes = $1, subtotal = $2, grand_total = $3 WHERE id = $4',
      [notes, grand_total, grand_total, billId]
    );

    await c.query('DELETE FROM salesman_bill_items WHERE bill_id = $1', [billId]);
    await c.query(
      `INSERT INTO salesman_bill_items (bill_id, product_id, item_name, unit_price, quantity, line_total)
       SELECT $1::int, * FROM unnest($2::int[], $3::text[], $4::numeric[], $5::int[], $6::numeric[])`,
      [
        billId,
        lines.map(l => l.product_id),
        lines.map(l => l.item_name),
        lines.map(l => l.unit_price),
        lines.map(l => l.quantity),
        lines.map(l => l.line_total),
      ]
    );

    return loadSalesmanBill(c, billId);
  });

  res.json({ bill, message: 'Delivery bill updated successfully' });
});

// DELETE /api/salesman/bills/:id — owner only
router.delete('/bills/:id', requireApi('owner'), async (req, res) => {
  const id = v.id(req.params.id);
  const { rowCount } = await query('DELETE FROM salesman_bills WHERE id=$1', [id]);
  if (!rowCount) throw new v.HttpError(404, 'Bill not found');
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
//  PAYMENTS — CASH (Paid to Salesman)
// ─────────────────────────────────────────────

router.post('/payments/cash', requireApi('owner', 'salesman'), async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }
  const isOwner = req.user.role === 'owner';
  let salesman_id = !isOwner ? req.user.id : (body.salesman_id ? v.id(body.salesman_id, 'Salesman') : null);
  let bill_id = body.bill_id ? v.id(body.bill_id, 'Bill') : null;

  if (isOwner && !salesman_id && bill_id) {
    const bCheck = await query('SELECT salesman_id FROM salesman_bills WHERE id=$1', [bill_id]);
    if (bCheck.rows.length) salesman_id = bCheck.rows[0].salesman_id;
  }

  if (isOwner && !salesman_id) {
    const { rows: smList } = await query("SELECT id FROM users WHERE role='salesman' AND is_active=TRUE ORDER BY id LIMIT 2");
    if (smList.length === 1) {
      salesman_id = smList[0].id;
    } else {
      throw new v.HttpError(400, 'Please select a salesman');
    }
  }

  // Auto-allocate to the oldest pending bill if no bill was explicitly chosen
  if (!bill_id) {
    const { rows: pendingBills } = await query(`
      SELECT sb.id, sb.grand_total,
             (COALESCE((SELECT SUM(amount) FROM salesman_cash_payments WHERE bill_id = sb.id), 0) +
              COALESCE((SELECT SUM(amount) FROM salesman_bank_payments WHERE bill_id = sb.id), 0)) AS paid
        FROM salesman_bills sb
       WHERE sb.salesman_id = $1
       ORDER BY sb.created_at ASC, sb.id ASC
    `, [salesman_id]);

    for (const pb of pendingBills) {
      if (Number(pb.paid) < Number(pb.grand_total)) {
        bill_id = pb.id;
        break;
      }
    }
    if (!bill_id && pendingBills.length) {
      bill_id = pendingBills[pendingBills.length - 1].id;
    }
  }

  const amount       = v.amount(body.amount, 'Amount', { min: 0.01, max: 100000000 });
  const payment_date = body.payment_date ? String(body.payment_date) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payment_date)) throw new v.HttpError(400, 'Invalid payment date');
  const received_by  = v.text(body.received_by || (isOwner ? 'Admin / Cashier' : req.user.name), 'Received by', { required: true, max: 100 });
  const notes        = v.text(body.notes || '', 'Notes', { required: false, max: 500 }) || null;

  const { rows } = await query("SELECT id FROM users WHERE id=$1 AND role='salesman' AND is_active=TRUE", [salesman_id]);
  if (!rows.length) throw new v.HttpError(404, 'Salesman not found');

  if (bill_id) {
    const bCheck = await query('SELECT id FROM salesman_bills WHERE id=$1 AND salesman_id=$2', [bill_id, salesman_id]);
    if (!bCheck.rows.length) throw new v.HttpError(400, 'Selected bill does not belong to this salesman');
  }

  const { rows: ins } = await query(
    `INSERT INTO salesman_cash_payments (salesman_id, bill_id, amount, payment_date, received_by, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [salesman_id, bill_id, amount, payment_date, received_by, notes, req.user.id]
  );
  res.status(201).json({ payment: ins[0] });
});

router.get('/payments/cash', requireApi('owner', 'salesman'), async (req, res) => {
  const isOwner = req.user.role === 'owner';
  const salesmanId = isOwner
    ? (req.query.salesman_id ? v.id(req.query.salesman_id, 'Salesman') : null)
    : req.user.id;
  const params = [];
  const where = [];
  if (salesmanId) { params.push(salesmanId); where.push(`cp.salesman_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT cp.*, u.name AS salesman_name, r.name AS recorded_by_name, sb.bill_number
       FROM salesman_cash_payments cp
       JOIN users u ON u.id = cp.salesman_id
       LEFT JOIN users r ON r.id = cp.recorded_by
       LEFT JOIN salesman_bills sb ON sb.id = cp.bill_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY cp.payment_date DESC, cp.id DESC`,
    params
  );
  res.json({ payments: rows });
});

router.delete('/payments/cash/:id', requireApi('owner'), async (req, res) => {
  const id = v.id(req.params.id);
  const { rowCount } = await query('DELETE FROM salesman_cash_payments WHERE id=$1', [id]);
  if (!rowCount) throw new v.HttpError(404, 'Payment not found');
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
//  PAYMENTS — BANK TRANSFER (Transferred to Salesman)
// ─────────────────────────────────────────────

router.post('/payments/bank', requireApi('owner', 'salesman'), async (req, res) => {
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) {}
  }
  const isOwner = req.user.role === 'owner';
  let salesman_id = !isOwner ? req.user.id : (body.salesman_id ? v.id(body.salesman_id, 'Salesman') : null);
  let bill_id = body.bill_id ? v.id(body.bill_id, 'Bill') : null;

  if (isOwner && !salesman_id && bill_id) {
    const bCheck = await query('SELECT salesman_id FROM salesman_bills WHERE id=$1', [bill_id]);
    if (bCheck.rows.length) salesman_id = bCheck.rows[0].salesman_id;
  }

  if (isOwner && !salesman_id) {
    const { rows: smList } = await query("SELECT id FROM users WHERE role='salesman' AND is_active=TRUE ORDER BY id LIMIT 2");
    if (smList.length === 1) {
      salesman_id = smList[0].id;
    } else {
      throw new v.HttpError(400, 'Please select a salesman');
    }
  }

  // Auto-allocate to the oldest pending bill if no bill was explicitly chosen
  if (!bill_id) {
    const { rows: pendingBills } = await query(`
      SELECT sb.id, sb.grand_total,
             (COALESCE((SELECT SUM(amount) FROM salesman_cash_payments WHERE bill_id = sb.id), 0) +
              COALESCE((SELECT SUM(amount) FROM salesman_bank_payments WHERE bill_id = sb.id), 0)) AS paid
        FROM salesman_bills sb
       WHERE sb.salesman_id = $1
       ORDER BY sb.created_at ASC, sb.id ASC
    `, [salesman_id]);

    for (const pb of pendingBills) {
      if (Number(pb.paid) < Number(pb.grand_total)) {
        bill_id = pb.id;
        break;
      }
    }
    if (!bill_id && pendingBills.length) {
      bill_id = pendingBills[pendingBills.length - 1].id;
    }
  }

  const amount        = v.amount(body.amount, 'Amount', { min: 0.01, max: 100000000 });
  const bank_account  = v.text(body.bank_account || '', 'Bank account', { required: false, max: 100 }) || null;
  const transfer_date = body.transfer_date ? String(body.transfer_date) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transfer_date)) throw new v.HttpError(400, 'Invalid transfer date');
  const transfer_id   = v.text(body.transfer_id, 'Transfer ID', { required: true, max: 100 });
  const proof_note    = v.text(body.proof_note || '', 'Proof note', { required: false, max: 500 }) || null;
  const notes         = v.text(body.notes || '', 'Notes', { required: false, max: 500 }) || null;

  const { rows: sm } = await query("SELECT id FROM users WHERE id=$1 AND role='salesman' AND is_active=TRUE", [salesman_id]);
  if (!sm.length) throw new v.HttpError(404, 'Salesman not found');

  if (bill_id) {
    const bCheck = await query('SELECT id FROM salesman_bills WHERE id=$1 AND salesman_id=$2', [bill_id, salesman_id]);
    if (!bCheck.rows.length) throw new v.HttpError(400, 'Selected bill does not belong to this salesman');
  }

  try {
    const { rows: ins } = await query(
      `INSERT INTO salesman_bank_payments (salesman_id, bill_id, amount, bank_account, transfer_date, transfer_id, proof_note, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [salesman_id, bill_id, amount, bank_account, transfer_date, transfer_id, proof_note, notes, req.user.id]
    );
    res.status(201).json({ payment: ins[0] });
  } catch (err) {
    if (err.code === '23505') throw new v.HttpError(409, 'This Transfer ID already exists. Duplicate transaction IDs are not allowed.');
    throw err;
  }
});

router.get('/payments/bank', requireApi('owner', 'salesman'), async (req, res) => {
  const isOwner = req.user.role === 'owner';
  const salesmanId = isOwner
    ? (req.query.salesman_id ? v.id(req.query.salesman_id, 'Salesman') : null)
    : req.user.id;
  const params = [];
  const where = [];
  if (salesmanId) { params.push(salesmanId); where.push(`bp.salesman_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT bp.*, u.name AS salesman_name, r.name AS recorded_by_name, sb.bill_number
       FROM salesman_bank_payments bp
       JOIN users u ON u.id = bp.salesman_id
       LEFT JOIN users r ON r.id = bp.recorded_by
       LEFT JOIN salesman_bills sb ON sb.id = bp.bill_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY bp.transfer_date DESC, bp.id DESC`,
    params
  );
  res.json({ payments: rows });
});

router.delete('/payments/bank/:id', requireApi('owner'), async (req, res) => {
  const id = v.id(req.params.id);
  const { rowCount } = await query('DELETE FROM salesman_bank_payments WHERE id=$1', [id]);
  if (!rowCount) throw new v.HttpError(404, 'Payment not found');
  res.json({ ok: true });
});

// ─────────────────────────────────────────────
//  SALESMAN SUMMARY / LEDGER
// ─────────────────────────────────────────────

// GET /api/salesman/summary — all salesmen overview (owner)
router.get('/summary', requireApi('owner'), async (req, res) => {
  const { rows: salesmen } = await query(
    "SELECT id, name, email, is_active FROM users WHERE role='salesman' ORDER BY LOWER(name)"
  );
  const summaries = await Promise.all(salesmen.map(async (s) => ({
    ...s,
    ...(await getSalesmanSummary(s.id)),
  })));
  res.json({ salesmen: summaries });
});

// GET /api/salesman/summary/:id — single salesman summary
router.get('/summary/:id', requireApi('owner', 'salesman'), async (req, res) => {
  const id = v.id(req.params.id);
  if (req.user.role !== 'owner' && req.user.id !== id) throw new v.HttpError(403, 'Access denied');
  const { rows } = await query('SELECT id, name, email, role, is_active FROM users WHERE id=$1', [id]);
  if (!rows.length || rows[0].role !== 'salesman') throw new v.HttpError(404, 'Salesman not found');
  const summary = await getSalesmanSummary(id);
  res.json({ salesman: rows[0], summary });
});

// GET /api/salesman/ledger/:id — full chronological transaction ledger for a salesman
router.get('/ledger/:id', requireApi('owner', 'salesman'), async (req, res) => {
  const id = v.id(req.params.id);
  if (req.user.role !== 'owner' && req.user.id !== id) throw new v.HttpError(403, 'Access denied');

  const { rows: smRows } = await query('SELECT id, name, email FROM users WHERE id=$1', [id]);
  if (!smRows.length) throw new v.HttpError(404, 'Salesman not found');

  const summary = await getSalesmanSummary(id);

  // 1. Bills (Debit = shop receives products & owes money)
  const { rows: bills } = await query(
    `SELECT 'bill' AS type,
            ('BILL-' || sb.bill_number) AS reference,
            sb.bill_number::text AS raw_ref,
            sb.grand_total AS debit,
            0 AS credit,
            COALESCE(sb.notes, ('Products Delivered (' ||
              COALESCE((SELECT COUNT(*) FROM salesman_bill_items bi WHERE bi.bill_id = sb.id), 0) || ' items, ' ||
              COALESCE((SELECT SUM(quantity) FROM salesman_bill_items bi WHERE bi.bill_id = sb.id), 0) || ' qty)')) AS description,
            sb.created_at AS txn_date,
            sb.id AS source_id
       FROM salesman_bills sb WHERE sb.salesman_id=$1`,
    [id]
  );

  // 2. Cash payments (Credit = shop pays cash to salesman)
  const { rows: cash } = await query(
    `SELECT 'cash' AS type,
            ('CASH-' || cp.id) AS reference,
            cp.id::text AS raw_ref,
            0 AS debit,
            cp.amount AS credit,
            COALESCE(cp.notes, ('Cash Payment to Salesman (Received by ' || cp.received_by || ')' ||
              CASE WHEN cp.bill_id IS NOT NULL THEN ' [Bill #' || sb.bill_number || ']' ELSE '' END)) AS description,
            cp.created_at AS txn_date,
            cp.id AS source_id
       FROM salesman_cash_payments cp
       LEFT JOIN salesman_bills sb ON sb.id = cp.bill_id
      WHERE cp.salesman_id=$1`,
    [id]
  );

  // 3. Bank payments (Credit = shop transfers bank money to salesman)
  const { rows: bank } = await query(
    `SELECT 'bank' AS type,
            bp.transfer_id AS reference,
            bp.transfer_id AS raw_ref,
            0 AS debit,
            bp.amount AS credit,
            COALESCE(bp.notes, ('Bank Transfer to Salesman' ||
              CASE WHEN bp.bank_account IS NOT NULL AND bp.bank_account <> '' THEN ' (' || bp.bank_account || ')' ELSE '' END ||
              CASE WHEN bp.bill_id IS NOT NULL THEN ' [Bill #' || sb.bill_number || ']' ELSE '' END)) AS description,
            bp.created_at AS txn_date,
            bp.id AS source_id
       FROM salesman_bank_payments bp
       LEFT JOIN salesman_bills sb ON sb.id = bp.bill_id
      WHERE bp.salesman_id=$1`,
    [id]
  );

  // Combine and sort chronologically (oldest to newest)
  const all = [...bills, ...cash, ...bank].sort((a, b) => new Date(a.txn_date) - new Date(b.txn_date));

  let runningBalance = 0;
  const ledger = all.map(row => {
    runningBalance += Number(row.debit) - Number(row.credit);
    return {
      ...row,
      debit: Number(row.debit),
      credit: Number(row.credit),
      balance: Math.round(runningBalance * 100) / 100,
    };
  });

  res.json({
    salesman: smRows[0],
    summary,
    ledger,
  });
});

// GET /api/salesman/dashboard — salesman's personal dashboard
router.get('/dashboard', requireApi('owner', 'salesman'), async (req, res) => {
  const id = req.user.id;
  const [summary, recentBills, recentCash, recentBank] = await Promise.all([
    getSalesmanSummary(id),
    query(`SELECT sb.id, sb.bill_number, sb.grand_total, sb.created_at,
                  (SELECT COUNT(*)::int FROM salesman_bill_items WHERE bill_id = sb.id) AS item_count,
                  (SELECT SUM(quantity)::int FROM salesman_bill_items WHERE bill_id = sb.id) AS total_quantity,
                  (COALESCE((SELECT SUM(amount) FROM salesman_cash_payments WHERE bill_id = sb.id), 0) +
                   COALESCE((SELECT SUM(amount) FROM salesman_bank_payments WHERE bill_id = sb.id), 0)) AS paid_amount
             FROM salesman_bills sb WHERE sb.salesman_id=$1 ORDER BY sb.created_at DESC LIMIT 8`, [id]),
    query(`SELECT cp.id, cp.amount, cp.payment_date, cp.received_by, cp.notes, sb.bill_number
             FROM salesman_cash_payments cp
             LEFT JOIN salesman_bills sb ON sb.id = cp.bill_id
            WHERE cp.salesman_id=$1 ORDER BY cp.payment_date DESC, cp.id DESC LIMIT 5`, [id]),
    query(`SELECT bp.id, bp.amount, bp.transfer_date, bp.transfer_id, bp.bank_account, sb.bill_number
             FROM salesman_bank_payments bp
             LEFT JOIN salesman_bills sb ON sb.id = bp.bill_id
            WHERE bp.salesman_id=$1 ORDER BY bp.transfer_date DESC, bp.id DESC LIMIT 5`, [id]),
  ]);
  res.json({
    user: req.user,
    summary,
    recentBills: recentBills.rows.map(b => ({
      ...b,
      grand_total: Number(b.grand_total),
      paid_amount: Number(b.paid_amount),
      remaining_balance: Math.max(0, Number(b.grand_total) - Number(b.paid_amount)),
    })),
    recentCash: recentCash.rows,
    recentBank: recentBank.rows,
  });
});

// GET /api/salesman/salesmen — list of active salesmen for dropdowns (owner only)
router.get('/salesmen', requireApi('owner'), async (req, res) => {
  const { rows } = await query("SELECT id, name, email, is_active FROM users WHERE role='salesman' ORDER BY LOWER(name)");
  res.json({ salesmen: rows });
});

// GET /api/salesman/admin-dashboard — admin-side aggregated stats
router.get('/admin-dashboard', requireApi('owner'), async (req, res) => {
  const [totals, salesmen, prods] = await Promise.all([
    query(`SELECT
      COALESCE((SELECT SUM(grand_total) FROM salesman_bills), 0) AS total_bills_amount,
      COALESCE((SELECT SUM(amount) FROM salesman_cash_payments), 0) AS total_cash_paid,
      COALESCE((SELECT SUM(amount) FROM salesman_bank_payments), 0) AS total_bank_paid,
      COALESCE((SELECT COUNT(*) FROM salesman_bills), 0)::int AS bill_count
    `),
    query("SELECT id, name, email FROM users WHERE role='salesman' AND is_active=TRUE ORDER BY LOWER(name)"),
    query("SELECT COALESCE(SUM(quantity), 0)::int AS total_products FROM salesman_bill_items"),
  ]);

  const t = totals.rows[0];
  const totalBillsAmount = Number(t.total_bills_amount);
  const totalCashPaid    = Number(t.total_cash_paid);
  const totalBankPaid    = Number(t.total_bank_paid);
  const totalPaid        = Math.round((totalCashPaid + totalBankPaid) * 100) / 100;
  const totalOutstanding = Math.max(0, Math.round((totalBillsAmount - totalPaid) * 100) / 100);

  const formattedTotals = {
    total_bills: t.bill_count,
    total_bill_amount: totalBillsAmount,
    total_cash: totalCashPaid,
    total_bank: totalBankPaid,
    total_paid: totalPaid,
    total_pending: totalOutstanding,
    total_products_delivered: Number(prods.rows[0].total_products),
  };

  const salesmenSummaries = await Promise.all(salesmen.rows.map(async s => ({
    ...s,
    ...(await getSalesmanSummary(s.id)),
  })));

  res.json({ totals: formattedTotals, salesmen: salesmenSummaries });
});

module.exports = router;
