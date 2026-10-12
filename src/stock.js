// Shared stock-status helpers. "p" must be the products table alias.
const STATUS_SQL = `CASE WHEN p.stock_qty <= 0 THEN 'out' WHEN p.stock_qty <= p.min_stock THEN 'low' ELSE 'ok' END`;

function stockStatus(qty, min) {
  if (qty <= 0) return 'out';
  if (qty <= min) return 'low';
  return 'ok';
}

module.exports = { STATUS_SQL, stockStatus };
