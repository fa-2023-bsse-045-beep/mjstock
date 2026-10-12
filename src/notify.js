// Optional low-stock alerts to the owner by email (Resend) and/or WhatsApp (CallMeBot).
// Each product is alerted at most once per day (tracked in stock_alert_log).
const { query } = require('./db');

const TZ = process.env.SHOP_TIMEZONE || 'Asia/Karachi';

const emailEnabled = () => !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO && process.env.ALERT_EMAIL_FROM);
const whatsappEnabled = () => !!(process.env.CALLMEBOT_PHONE && process.env.CALLMEBOT_APIKEY);

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

function sendEmail(subject, body) {
  return fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.ALERT_EMAIL_FROM,
      to: process.env.ALERT_EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean),
      subject,
      text: body,
    }),
  });
}

function sendWhatsApp(body) {
  const params = new URLSearchParams({
    phone: process.env.CALLMEBOT_PHONE,
    text: body,
    apikey: process.env.CALLMEBOT_APIKEY,
  });
  return fetchWithTimeout(`https://api.callmebot.com/whatsapp.php?${params}`);
}

// items: [{ id, name, stock_qty, min_stock, status }]
async function notifyLowStock(items) {
  if (!items.length || (!emailEnabled() && !whatsappEnabled())) return;
  try {
    const { rows } = await query(
      `INSERT INTO stock_alert_log (product_id, alert_date)
       SELECT unnest($1::int[]), (NOW() AT TIME ZONE $2)::date
       ON CONFLICT DO NOTHING
       RETURNING product_id`,
      [items.map((i) => i.id), TZ]
    );
    const fresh = new Set(rows.map((r) => r.product_id));
    const toSend = items.filter((i) => fresh.has(i.id));
    if (!toSend.length) return;

    const lines = toSend.map((i) =>
      i.status === 'out'
        ? `- ${i.name}: OUT OF STOCK`
        : `- ${i.name}: low, only ${i.stock_qty} left (minimum ${i.min_stock})`
    );
    const body = `MJ AUTOS stock alert\n\n${lines.join('\n')}\n\nPlease restock soon.`;

    const jobs = [];
    if (emailEnabled()) jobs.push(sendEmail(`MJ AUTOS: ${toSend.length} item(s) need restocking`, body));
    if (whatsappEnabled()) jobs.push(sendWhatsApp(body));
    const results = await Promise.allSettled(jobs);
    const failed = results.filter((r) => r.status === 'rejected');
    failed.forEach((r) => console.error('[notify] send failed:', r.reason.message));
    if (failed.length === results.length) {
      // Nothing was delivered: forget today's log so the next sale tries again.
      await query(
        'DELETE FROM stock_alert_log WHERE product_id = ANY($1::int[]) AND alert_date = (NOW() AT TIME ZONE $2)::date',
        [toSend.map((i) => i.id), TZ]
      );
    }
  } catch (err) {
    console.error('[notify] error:', err.message);
  }
}

module.exports = { notifyLowStock };
