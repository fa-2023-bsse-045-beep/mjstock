(function () {
  const $ = (id) => document.getElementById(id);
  let bills = [];

  async function load(append = false) {
    const params = new URLSearchParams();
    if ($('q').value.trim()) params.set('q', $('q').value.trim());
    if ($('date').value) params.set('date', $('date').value);
    if ($('payMethodFilter') && $('payMethodFilter').value) params.set('payment_method', $('payMethodFilter').value);
    if (append) params.set('offset', String(bills.length));
    try {
      const data = await App.api('/api/bills?' + params);
      bills = append ? bills.concat(data.bills) : data.bills;
      $('todayTotal').textContent = App.money(data.today.total);
      if ($('todayCash')) $('todayCash').textContent = App.money(data.today.cash_total || 0);
      if ($('todayAccount')) $('todayAccount').textContent = App.money(data.today.account_total || 0);
      $('todayCount').textContent = data.today.count;
      $('moreBtn').classList.toggle('hidden', !data.hasMore);
      render();
    } catch (err) {
      App.toast(err.message, 'error');
    }
  }

  function render() {
    if (!bills.length) {
      $('rows').innerHTML = '<tr><td colspan="8" class="empty">No bills found.</td></tr>';
      return;
    }
    let lastDate = null;
    let html = '';
    for (const b of bills) {
      if (b.local_date !== lastDate) {
        lastDate = b.local_date;
        const dayTotal = bills.filter((x) => x.local_date === lastDate).reduce((s, x) => s + Number(x.grand_total), 0);
        html += `<tr class="date-group"><td colspan="6">${App.esc(App.dateLabel(lastDate))}</td><td class="num">${App.money(dayTotal)}</td><td></td></tr>`;
      }
      const payBadge = b.payment_method === 'account'
        ? `<span class="badge-account">💳 ${App.esc(b.payment_account || 'Account')}</span>`
        : `<span class="badge-cash">💵 Cash</span>`;

      html += `<tr>
        <td><b>#${b.bill_number}</b></td>
        <td class="nowrap">${App.time(b.created_at)}</td>
        <td>${App.esc(b.customer_name || '-')}</td>
        <td>${payBadge}</td>
        <td class="num hide-sm">${b.item_count}</td>
        <td class="hide-sm">${App.esc(b.cashier_name || '-')}</td>
        <td class="num"><b>${App.money(b.grand_total)}</b></td>
        <td class="actions">
          <button class="btn btn-sm" data-act="view" data-id="${b.id}">Open / Print</button>
          <button class="btn btn-sm btn-danger" data-act="delete" data-id="${b.id}">Delete</button>
        </td>
      </tr>`;
    }
    $('rows').innerHTML = html;
  }

  $('rows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = bills.find((x) => x.id === Number(btn.dataset.id));
    if (!b) return;
    if (btn.dataset.act === 'view') {
      try {
        App.showBill((await App.api('/api/bills/' + b.id)).bill);
      } catch (err) { App.toast(err.message, 'error'); }
    }
    if (btn.dataset.act === 'delete') {
      const ok = await App.confirm(`Delete bill #${b.bill_number} (${App.money(b.grand_total)})? The sold stock will be added back.`, { okText: 'Delete bill', danger: true });
      if (!ok) return;
      try {
        await App.api('/api/bills/' + b.id, { method: 'DELETE' });
        App.toast(`Bill #${b.bill_number} deleted, stock returned`, 'success');
        App.refreshAlerts();
        load();
      } catch (err) { App.toast(err.message, 'error'); }
    }
  });

  $('filterForm').addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $('resetBtn').addEventListener('click', () => {
    $('q').value = '';
    $('date').value = '';
    if ($('payMethodFilter')) $('payMethodFilter').value = '';
    load();
  });
  if ($('payMethodFilter')) $('payMethodFilter').addEventListener('change', () => load());
  $('moreBtn').addEventListener('click', () => load(true));

  App.init('bills').then(() => load());
})();
