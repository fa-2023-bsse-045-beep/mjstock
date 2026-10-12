(function () {
  const $ = (id) => document.getElementById(id);
  let alerts = [];

  async function load() {
    try {
      const d = await App.api('/api/dashboard');
      alerts = d.alerts;
      $('todayTotal').textContent = App.money(d.today.total);
      $('todayCount').textContent = d.today.count;
      $('productCount').textContent = d.productCount;
      $('alertCount').textContent = d.alerts.length;

      $('alertRows').innerHTML = d.alerts.length
        ? d.alerts
            .map(
              (p) => `<tr>
                <td><b>${App.esc(p.name)}</b></td>
                <td class="num">${p.stock_qty}</td>
                <td class="num">${p.min_stock}</td>
                <td>${App.statusBadge(p.status)}</td>
                <td class="actions"><button class="btn btn-sm btn-success" data-restock="${p.id}">Restock</button></td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="empty">All products are well stocked.</td></tr>';

      $('recentRows').innerHTML = d.recentBills.length
        ? d.recentBills
            .map(
              (b) => `<tr>
                <td><b>#${b.bill_number}</b></td>
                <td class="nowrap">${App.dateTime(b.created_at)}</td>
                <td>${App.esc(b.customer_name || '-')}</td>
                <td class="num">${App.money(b.grand_total)}</td>
                <td class="actions"><button class="btn btn-sm" data-bill="${b.id}">View</button></td>
              </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="empty">No bills yet.</td></tr>';
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  document.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-restock]');
    if (r) App.openRestock(alerts.find((p) => p.id === Number(r.dataset.restock)));
    const b = e.target.closest('[data-bill]');
    if (b) {
      try {
        const { bill } = await App.api('/api/bills/' + b.dataset.bill);
        App.showBill(bill);
      } catch (err) { App.toast(err.message, 'error'); }
    }
  });
  document.addEventListener('mj:stock-changed', load);

  App.init('dashboard').then(load);
})();
