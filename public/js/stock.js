(function () {
  const $ = (id) => document.getElementById(id);
  let status = 'all';
  let products = [];

  async function load() {
    try {
      const data = await App.api('/api/stock?status=' + status);
      products = data.products;
      Object.entries(data.summary).forEach(([k, n]) => {
        const el = document.querySelector(`[data-count="${k}"]`);
        if (el) el.textContent = `(${n})`;
      });
      render();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  function render() {
    const q = $('search').value.trim().toLowerCase();
    const list = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;
    $('rows').innerHTML = list.length
      ? list
          .map(
            (p) => `<tr>
              <td><b>${App.esc(p.name)}</b></td>
              <td class="num">${App.money(p.price)}</td>
              <td class="num">${p.stock_qty}</td>
              <td class="num">${p.min_stock}</td>
              <td>${App.statusBadge(p.status)}</td>
              <td class="actions">
                <button class="btn btn-sm" data-act="history" data-id="${p.id}">History</button>
                <button class="btn btn-sm btn-success" data-act="restock" data-id="${p.id}">Restock</button>
              </td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="6" class="empty">No products in this list.</td></tr>';
  }

  const REASON = { sale: 'Sale', restock: 'Restock', adjustment: 'Adjustment' };

  async function showHistory(id) {
    try {
      const { product, movements } = await App.api(`/api/stock/${id}/movements`);
      const rows = movements.length
        ? movements
            .map(
              (m) => `<tr>
                <td class="nowrap">${App.dateTime(m.created_at)}</td>
                <td class="num" style="color:${m.change_qty > 0 ? 'var(--ok)' : 'var(--out)'}"><b>${m.change_qty > 0 ? '+' : ''}${m.change_qty}</b></td>
                <td>${REASON[m.reason] || App.esc(m.reason)}</td>
                <td>${App.esc(m.note || '')}</td>
                <td>${App.esc(m.user_name || '-')}</td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="empty">No stock movements yet.</td></tr>';
      const d = App.dialog({
        title: 'Stock history: ' + product.name,
        wide: true,
        body: `
          <p style="margin-top:0">Current stock <b>${product.stock_qty}</b> · Minimum <b>${product.min_stock}</b> · ${App.statusBadge(product.status)}</p>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Date</th><th class="num">Change</th><th>Reason</th><th>Note</th><th>By</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>
          ${movements.length >= 200 ? '<p class="small muted">Showing the latest 200. Export to see all.</p>' : ''}`,
        foot: `<a class="btn btn-dark" href="/api/stock/${product.id}/movements.csv">Export history CSV</a><button class="btn" data-close>Close</button>`,
      });
      d.querySelector('[data-close]').addEventListener('click', () => d.close());
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  $('statusFilter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    status = b.dataset.status;
    document.querySelectorAll('#statusFilter button').forEach((x) => x.classList.toggle('active', x === b));
    $('exportBtn').href = '/api/stock/export.csv?status=' + status;
    load();
  });
  $('rows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'history') showHistory(id);
    if (btn.dataset.act === 'restock') App.openRestock(products.find((p) => p.id === id));
  });
  $('search').addEventListener('input', render);
  document.addEventListener('mj:stock-changed', load);

  // Allow linking to a filter, e.g. /stock?status=low
  const initial = new URLSearchParams(location.search).get('status');
  App.init('stock').then(() => {
    const btn = document.querySelector(`#statusFilter [data-status="${initial}"]`);
    if (btn) btn.click();
    else load();
  });
})();
